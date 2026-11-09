"""Regime detector orchestration: training pipeline, artifact persistence and read helpers.

``train()`` runs: features → walk-forward (all folds) → live fit on all data → risk stats →
per-regime spot-VIX parameters → validation. Artifacts in ``data/processed/regime/``:

- ``fold_<train_end>.joblib`` / ``.json``  every walk-forward fold
- ``live_model.joblib`` / ``live_model.json``  model fitted on all data
- ``history.parquet``      walk-forward history (2008-2013 in-sample, 2014+ out-of-sample)
- ``live.parquet``         live-model filtered + hindsight-smoothed probabilities, labels
- ``risk_stats.json``      next-day UVXY stats per regime (out-of-sample, smoothed HMM labels)
- ``vix_params.json``      per-regime spot-VIX process parameters for the Monte Carlo simulator
- ``validation.json``      validation results
- ``train_summary.json``   last training run summary

Run: ``python -m app.regime.service``
"""

from __future__ import annotations

import fcntl
import json
import logging
import shutil
import tempfile
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

import joblib
import pandas as pd
from threadpoolctl import threadpool_limits

from app.core.config import Settings, get_settings
from app.data.build_dataset import load_panel
from app.montecarlo.calibration import calibrate_spot_vix
from app.regime.artifacts import _clean, _json_default, write_json
from app.regime.baseline import baseline_labels
from app.regime.features import build_features
from app.regime.hmm_model import RegimeModel, fit_regime_model, prob_column
from app.regime.risk_stats import (
    empirical_transition_matrix,
    regime_vix_params,
    risk_stats_by_regime,
)
from app.regime.validation import run_validation
from app.regime.walk_forward import label_history, run_walk_forward

log = logging.getLogger(__name__)
_train_lock = threading.Lock()


class NotTrainedError(RuntimeError):
    """Raised when artifacts are requested before ``train()`` has run."""


def read_json(path: Path):
    if not path.exists():
        raise NotTrainedError(f"{path.name} missing: train the regime model first")
    return json.loads(path.read_text())


class TrainingInProgressError(RuntimeError):
    """Raised by a non-blocking ``train`` call while another run holds the lock."""


@contextmanager
def _training_lock(settings: Settings, blocking: bool) -> Iterator[None]:
    """Thread lock (this process) + ``flock`` on a lock file (other processes, e.g. the CLI)."""
    if not _train_lock.acquire(blocking=blocking):
        raise TrainingInProgressError("training already running")
    try:
        settings.processed_dir.mkdir(parents=True, exist_ok=True)
        with open(settings.processed_dir / ".regime_train.lock", "w") as fh:
            flags = fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB)
            try:
                fcntl.flock(fh, flags)
            except BlockingIOError as exc:
                raise TrainingInProgressError("training already running") from exc
            try:
                yield
            finally:
                fcntl.flock(fh, fcntl.LOCK_UN)
    finally:
        _train_lock.release()


def is_training() -> bool:
    return _train_lock.locked()


def train(
    settings: Settings | None = None, n_jobs: int | None = None, blocking: bool = True
) -> dict:
    """Full retrain. With ``blocking=False`` raises ``TrainingInProgressError`` instead of
    waiting for a run already in progress (in this or another process)."""
    settings = settings or get_settings()
    n_jobs = settings.train_n_jobs if n_jobs is None else n_jobs
    with _training_lock(settings, blocking), threadpool_limits(settings.train_blas_threads):
        return _train(settings, n_jobs)


def _train(settings: Settings, n_jobs: int) -> dict:
    t0 = time.perf_counter()
    final = settings.regime_dir
    # Build every artifact in a staging directory and swap it in only after success, so a
    # failed or in-progress run never leaves a mix of old and new artifacts for the API.
    final.parent.mkdir(parents=True, exist_ok=True)
    out = Path(tempfile.mkdtemp(prefix=final.name + ".staging-", dir=final.parent))
    try:
        summary = _train_into(settings, out, t0, n_jobs)
    except BaseException:
        shutil.rmtree(out, ignore_errors=True)
        raise
    _swap_in(out, final)
    return summary


def _train_into(settings: Settings, out: Path, t0: float, n_jobs: int) -> dict:
    cfg = settings.regime

    panel = load_panel().set_index("date").sort_index()
    feats = build_features(panel.reset_index(), cfg)
    hist, fold_meta, models = run_walk_forward(
        feats, cfg, out_dir=out, n_jobs=n_jobs, blas_threads=settings.train_blas_threads
    )
    names = list(next(iter(models.values())).names)

    # Live model on all data.
    t_live = time.perf_counter()
    live_model = fit_regime_model(feats, cfg)
    live_runtime = time.perf_counter() - t_live
    joblib.dump(live_model, out / "live_model.joblib")
    write_json(out / "live_model.json", live_model.metadata() | {"runtime_s": live_runtime})

    live = live_model.filtered_proba(feats)
    pcols = [prob_column(n) for n in names]
    live = label_history(live, names, pcols, cfg)
    smoothed = live_model.smoothed_proba(feats)
    for c in pcols:
        live[f"hs_{c}"] = smoothed[c]  # hindsight (smoothed) view: diagnostics only
    live["baseline_label"] = baseline_labels(feats, cfg.baseline)
    live = live.join(feats)

    hist.to_parquet(out / "history.parquet")
    live.to_parquet(out / "live.parquet")

    oos = hist[~hist["in_sample"]]
    # Next-day pairs come from the full panel calendar, never from feature rows alone.
    uvxy, vix = panel["uvxy_close"], panel["vix"]
    risk = {
        "hmm": risk_stats_by_regime(oos["smoothed_label"], uvxy, names),
        "baseline": risk_stats_by_regime(oos["baseline_label"], uvxy, names),
        "empirical_transition": empirical_transition_matrix(oos["smoothed_label"], names)
        .round(6)
        .to_dict(orient="index"),
        "period": {
            "start": oos.index.min().date().isoformat(),
            "end": oos.index.max().date().isoformat(),
        },
    }
    write_json(out / "risk_stats.json", risk)

    vix_params = {
        "model": "one_factor: x[t+1] = ln theta + b (x[t] - ln theta) + sigma sqrt(dt) Z + J N, "
        "b = exp(-kappa dt), N ~ Bernoulli(lam dt), J ~ N(mu_j, sigma_j), x = ln VIX, dt = 1/252",
        "source": "out-of-sample smoothed HMM labels",
        "all_days": calibrate_spot_vix(oos["vix"], cfg.jump),
        "by_regime": regime_vix_params(vix, oos["smoothed_label"], cfg.jump),
    }
    write_json(out / "vix_params.json", vix_params)

    validation = run_validation(hist, names, cfg, uvxy_close=uvxy)
    write_json(out / "validation.json", validation)

    summary = {
        "trained_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "runtime_s": round(time.perf_counter() - t0, 2),
        "n_folds": len(fold_meta),
        "refit_freq": cfg.refit_freq,
        "features": cfg.features,
        "data_start": feats.index.min().date().isoformat(),
        "data_end": feats.index.max().date().isoformat(),
        "folds": [
            {
                "fold_id": m["fold_id"],
                "train_start": m["train_start"],
                "train_end": m["train_end"],
                "test_start": m.get("test_start"),
                "test_end": m.get("test_end"),
                "n_train": m["n_train"],
                "log_likelihood": m["log_likelihood"],
                "runtime_s": m.get("runtime_s"),
            }
            for m in fold_meta
        ],
        "live": {
            "train_end": live_model.train_end,
            "log_likelihood": live_model.log_likelihood,
            "runtime_s": round(live_runtime, 2),
        },
    }
    write_json(out / "train_summary.json", summary)
    log.info("regime training done in %.1fs", summary["runtime_s"])
    return summary


def _swap_in(staging: Path, final: Path) -> None:
    backup = final.with_name(final.name + ".old")
    if backup.exists():
        shutil.rmtree(backup)
    if final.exists():
        final.rename(backup)
    staging.rename(final)
    if backup.exists():
        shutil.rmtree(backup)


# ---------------------------------------------------------------------------- loaders
def _dir(settings: Settings | None) -> Path:
    return (settings or get_settings()).regime_dir


def load_live_model(settings: Settings | None = None) -> RegimeModel:
    path = _dir(settings) / "live_model.joblib"
    if not path.exists():
        raise NotTrainedError("live model missing: train the regime model first")
    return joblib.load(path)


def load_frame(name: str, settings: Settings | None = None) -> pd.DataFrame:
    path = _dir(settings) / f"{name}.parquet"
    if not path.exists():
        raise NotTrainedError(f"{name}.parquet missing: train the regime model first")
    return pd.read_parquet(path)


def load_json(name: str, settings: Settings | None = None):
    return read_json(_dir(settings) / f"{name}.json")


def load_folds(settings: Settings | None = None) -> list[dict]:
    d = _dir(settings)
    files = sorted(d.glob("fold_*.json"))
    if not files:
        raise NotTrainedError("no folds: train the regime model first")
    return [json.loads(f.read_text()) for f in files]


def revalidate(settings: Settings | None = None) -> dict:
    """Recompute ``validation.json`` from the saved walk-forward history without refitting."""
    settings = settings or get_settings()
    with _training_lock(settings, blocking=True):
        hist = load_frame("history", settings)
        names = list(load_live_model(settings).names)
        panel = load_panel().set_index("date").sort_index()
        validation = run_validation(hist, names, settings.regime, uvxy_close=panel["uvxy_close"])
        write_json(settings.regime_dir / "validation.json", validation)
        return validation


def main() -> None:
    import argparse

    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(description="Train the regime detector")
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="recompute validation.json from saved history without refitting",
    )
    args = parser.parse_args()
    result = {"summary": revalidate()["summary"]} if args.validate_only else train()
    print(json.dumps(_clean(result), indent=2, default=_json_default))


if __name__ == "__main__":
    main()
