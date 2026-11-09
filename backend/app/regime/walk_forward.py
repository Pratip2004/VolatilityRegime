"""Expanding-window walk-forward training.

First training window: ``analysis_start`` → ``first_train_end``. Each fold refits the scaler and
HMM on all data up to its ``train_end`` and produces filtered probabilities for the next period
only (yearly or quarterly), continuing the forward recursion from the last training day.

The first fold's own training window (2008-2013 by default) is also filtered and marked
``in_sample=True`` so the history covers the whole analysis window; validation reports those
dates separately.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from pathlib import Path

import joblib
import pandas as pd
from joblib import Parallel, delayed

from app.core.config import RegimeConfig
from app.regime.baseline import baseline_labels
from app.regime.hmm_model import RegimeModel, fit_regime_model, prob_column
from app.regime.smoothing import days_in_regime, raw_labels, smooth_labels

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Fold:
    fold_id: str
    train_end: pd.Timestamp
    test_start: pd.Timestamp
    test_end: pd.Timestamp


def fold_schedule(
    dates: pd.DatetimeIndex, first_train_end: str, freq: str = "yearly"
) -> list[Fold]:
    """Train-end dates at year (or quarter) ends from ``first_train_end``; each test period runs
    to the next train end (the last one to the final date)."""
    first = pd.Timestamp(first_train_end)
    last = dates.max()
    step = pd.offsets.YearEnd() if freq == "yearly" else pd.offsets.QuarterEnd()
    ends = [first]
    while ends[-1] + step < last:
        ends.append(ends[-1] + step)
    folds = []
    for i, te in enumerate(ends):
        test_end = ends[i + 1] if i + 1 < len(ends) else last
        test_dates = dates[(dates > te) & (dates <= test_end)]
        if len(test_dates) == 0:
            continue
        folds.append(
            Fold(
                fold_id=te.date().isoformat(),
                train_end=te,
                test_start=test_dates.min(),
                test_end=test_dates.max(),
            )
        )
    return folds


def _fit_fold(features: pd.DataFrame, fold: Fold, cfg: RegimeConfig) -> tuple[RegimeModel, float]:
    t0 = time.perf_counter()
    train = features[features.index <= fold.train_end]
    model = fit_regime_model(train, cfg)
    return model, time.perf_counter() - t0


def save_fold(model: RegimeModel, fold: Fold, out_dir: Path, runtime: float) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, out_dir / f"fold_{fold.fold_id}.joblib")
    meta = model.metadata() | {
        "fold_id": fold.fold_id,
        "test_start": fold.test_start.date().isoformat(),
        "test_end": fold.test_end.date().isoformat(),
        "runtime_s": round(runtime, 2),
        "transmat": model.transmat.tolist(),
    }
    (out_dir / f"fold_{fold.fold_id}.json").write_text(json.dumps(meta, indent=2))
    return meta


def run_walk_forward(
    features: pd.DataFrame,
    cfg: RegimeConfig,
    out_dir: Path | None = None,
    n_jobs: int = -1,
) -> tuple[pd.DataFrame, list[dict], dict[str, RegimeModel]]:
    """Returns (history, fold metadata, models by fold id).

    ``history`` columns: ``p_<name>..., raw_label, smoothed_label, days_in_regime, fold_id,
    in_sample, baseline_label`` plus the feature/context columns, indexed by date.
    """
    folds = fold_schedule(features.index, cfg.first_train_end, cfg.refit_freq)
    if not folds:
        raise ValueError("no walk-forward folds: not enough data after first_train_end")
    results = Parallel(n_jobs=n_jobs)(delayed(_fit_fold)(features, f, cfg) for f in folds)

    parts: list[pd.DataFrame] = []
    metas: list[dict] = []
    models: dict[str, RegimeModel] = {}
    for i, (fold, (model, runtime)) in enumerate(zip(folds, results, strict=True)):
        models[fold.fold_id] = model
        if out_dir is not None:
            metas.append(save_fold(model, fold, out_dir, runtime))
        else:
            metas.append(model.metadata() | {"fold_id": fold.fold_id, "runtime_s": runtime})
        if i == 0:
            train = features[features.index <= fold.train_end]
            p_in = model.filtered_proba(train)
            p_in["fold_id"] = fold.fold_id
            p_in["in_sample"] = True
            parts.append(p_in)
        test = features[(features.index > fold.train_end) & (features.index <= fold.test_end)]
        p = model.filtered_proba(test, prev_log_alpha=model.last_log_alpha)
        p["fold_id"] = fold.fold_id
        p["in_sample"] = False
        parts.append(p)

    hist = pd.concat(parts).sort_index()
    names = list(models[folds[0].fold_id].names)
    pcols = [prob_column(n) for n in names]
    hist = label_history(hist, names, pcols, cfg)
    hist["baseline_label"] = baseline_labels(features.loc[hist.index], cfg.baseline)
    hist = hist.join(features)
    return hist, metas, models


def label_history(
    probs: pd.DataFrame, names: list[str], pcols: list[str], cfg: RegimeConfig
) -> pd.DataFrame:
    out = probs.copy()
    out["raw_label"] = raw_labels(probs[pcols], names)
    out["smoothed_label"] = smooth_labels(probs[pcols], names, cfg.hysteresis)
    out["days_in_regime"] = days_in_regime(out["smoothed_label"])
    return out
