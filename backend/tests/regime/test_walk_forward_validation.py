from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest

from app.core.config import RegimeConfig
from app.montecarlo.calibration import calibrate_by_regime, calibrate_log_ou
from app.regime.features import build_features
from app.regime.risk_stats import (
    empirical_transition_matrix,
    next_day_returns,
    risk_stats_by_regime,
)
from app.regime.validation import (
    known_episodes,
    run_validation,
    spike_days,
    spike_lead_time,
)
from app.regime.walk_forward import fold_schedule, run_walk_forward
from tests.conftest import make_panel

CFG = RegimeConfig(n_restarts=2, n_iter=100, first_train_end="2009-12-31")
NAMES = ["Calm", "Stressed", "Panic"]


@pytest.fixture(scope="module")
def wf(tmp_path_factory):
    feats = build_features(make_panel(n=1400, seed=2), CFG)
    out = tmp_path_factory.mktemp("regime")
    hist, metas, models = run_walk_forward(feats, CFG, out_dir=out, n_jobs=1)
    return feats, hist, metas, models, out


# ---------------------------------------------------------------------------- schedule
def test_fold_schedule_yearly_and_quarterly() -> None:
    dates = pd.bdate_range("2008-01-01", "2011-06-30")
    yearly = fold_schedule(dates, "2008-12-31", "yearly")
    assert [f.fold_id for f in yearly] == ["2008-12-31", "2009-12-31", "2010-12-31"]
    assert yearly[-1].test_end == dates.max()
    q = fold_schedule(dates, "2008-12-31", "quarterly")
    assert q[1].fold_id == "2009-03-31" and len(q) == 10
    for a, b in zip(q[:-1], q[1:], strict=True):
        assert a.test_end < b.test_start  # test periods don't overlap


# ---------------------------------------------------------------------------- walk-forward
def test_no_test_date_in_its_own_training_window(wf) -> None:
    feats, hist, metas, models, _ = wf
    for fid, model in models.items():
        test_dates = hist.index[(hist["fold_id"] == fid) & ~hist["in_sample"]]
        assert len(test_dates) > 0
        assert pd.Timestamp(model.train_end) < test_dates.min()
        assert model.n_train == int((feats.index <= pd.Timestamp(fid)).sum())


def test_scaler_fitted_on_training_data_only(wf) -> None:
    feats, _, _, models, _ = wf
    for fid, model in models.items():
        train = feats.loc[feats.index <= pd.Timestamp(fid), model.features]
        np.testing.assert_allclose(model.scaler.mean_, train.mean().to_numpy())
        np.testing.assert_allclose(model.scaler.scale_, train.std(ddof=0).to_numpy())


def test_history_covers_all_days_once_with_valid_probs(wf) -> None:
    feats, hist, _, _, _ = wf
    assert hist.index.is_unique
    assert hist.index.equals(feats.index)
    p = hist[["p_calm", "p_stressed", "p_panic"]]
    np.testing.assert_allclose(p.sum(axis=1), 1.0, atol=1e-9)
    assert hist.loc[hist.index <= "2009-12-31", "in_sample"].all()
    assert not hist.loc[hist.index > "2009-12-31", "in_sample"].any()
    assert set(hist["smoothed_label"]) <= set(NAMES)


def test_oos_probs_match_fold_model_continuation(wf) -> None:
    """Fold test probabilities equal a single filter pass of that fold's model over
    train + test, i.e. the test period starts from proper prior state probabilities."""
    feats, hist, _, models, _ = wf
    fid = "2010-12-31"
    model = models[fid]
    upto = feats[feats.index <= hist.index[hist["fold_id"] == fid].max()]
    single = model.filtered_proba(upto)
    test_idx = hist.index[(hist["fold_id"] == fid) & ~hist["in_sample"]]
    np.testing.assert_allclose(
        hist.loc[test_idx, ["p_calm", "p_stressed", "p_panic"]].to_numpy(),
        single.loc[test_idx].to_numpy(),
        atol=1e-9,
    )


def test_fold_artifacts_persisted(wf) -> None:
    _, _, metas, models, out = wf
    for fid in models:
        meta = json.loads((out / f"fold_{fid}.json").read_text())
        assert meta["train_end"] <= fid
        assert set(meta) >= {
            "scaler",
            "state_mapping",
            "log_likelihood",
            "features",
            "train_start",
            "train_end",
            "restarts",
        }
        assert (out / f"fold_{fid}.joblib").exists()
    assert len(metas) == len(models)


# ---------------------------------------------------------------------------- risk stats
def test_next_day_returns_shift_exactly_one_day() -> None:
    close = pd.Series([100.0, 110.0, 99.0, 99.0], index=pd.bdate_range("2020-01-01", periods=4))
    r = next_day_returns(close)
    assert r.iloc[0] == pytest.approx(0.10)
    assert r.iloc[1] == pytest.approx(-0.10)
    assert r.iloc[2] == pytest.approx(0.0)
    assert np.isnan(r.iloc[3])


def test_risk_stats_use_label_at_t_and_return_t_to_t1() -> None:
    idx = pd.bdate_range("2020-01-01", periods=6)
    close = pd.Series([100, 130, 130, 65, 65, 65.0], index=idx)
    labels = pd.Series(["Panic", "Calm", "Panic", "Calm", "Calm", "Calm"], index=idx)
    rs = risk_stats_by_regime(labels, close, NAMES)
    # Panic days: t0 (→ +30%), t2 (→ -50%). Calm: t1 (0%), t3 (0%), t4 (0%), t5 (no next).
    assert rs["Panic"]["count"] == 2
    assert rs["Panic"]["mean"] == pytest.approx((0.30 - 0.50) / 2)
    assert rs["Panic"]["prob_up_20"] == pytest.approx(0.5)
    assert rs["Calm"]["count"] == 3 and rs["Calm"]["mean"] == pytest.approx(0.0)
    assert rs["Stressed"]["count"] == 0
    assert rs["Panic"]["next_regime_prob"]["Calm"] == pytest.approx(1.0)


def test_risk_stats_on_label_subset_uses_full_close_series() -> None:
    idx = pd.bdate_range("2020-01-01", periods=4)
    close = pd.Series([100, 110, 121, 133.1], index=idx)
    labels = pd.Series(["Calm", "Calm"], index=idx[[0, 2]])
    rs = risk_stats_by_regime(labels, close, NAMES)
    assert rs["Calm"]["mean"] == pytest.approx(0.10)


def test_empirical_transition_rows_sum_to_one() -> None:
    labels = pd.Series(["Calm", "Calm", "Panic", "Stressed", "Calm"])
    m = empirical_transition_matrix(labels, NAMES)
    assert m.loc["Calm", "Calm"] == pytest.approx(0.5)
    assert m.loc["Calm", "Panic"] == pytest.approx(0.5)
    np.testing.assert_allclose(m.sum(axis=1), 1.0)


# ---------------------------------------------------------------------------- calibration
def test_log_ou_calibration_recovers_parameters_and_jumps() -> None:
    """Simulate the simulator's own one-factor process and recover its parameters."""
    rng = np.random.default_rng(0)
    kappa, theta, sigma, lam, mu_j, sigma_j, dt = 5.0, 18.0, 0.9, 8.0, 0.25, 0.05, 1 / 252
    b = np.exp(-kappa * dt)
    x = np.empty(30000)
    x[0] = np.log(theta)
    for t in range(1, len(x)):
        x[t] = (
            np.log(theta)
            + b * (x[t - 1] - np.log(theta))
            + sigma * np.sqrt(dt) * (rng.standard_normal())
        )
        if rng.random() < lam * dt:
            x[t] += mu_j + sigma_j * rng.standard_normal()
    v = np.exp(x)
    p = calibrate_log_ou(v[:-1], v[1:])
    assert p["theta"] == pytest.approx(theta, rel=0.1)
    assert p["sigma"] == pytest.approx(sigma, rel=0.05)
    assert p["kappa"] == pytest.approx(kappa, rel=0.5)
    assert p["lam"] == pytest.approx(lam, rel=0.25)
    assert p["mu_j"] == pytest.approx(mu_j, rel=0.15)


def test_calibration_without_mean_reversion_returns_no_kappa() -> None:
    v = np.exp(0.5 * 1.02 ** np.arange(100))  # explosive AR(1) in log VIX: b = 1.02
    p = calibrate_log_ou(v[:-1], v[1:])
    assert p["kappa"] is None and p["theta"] is None
    assert calibrate_log_ou(v[:5], v[1:6])["n"] == 5


def test_calibrate_by_regime_splits_days() -> None:
    idx = pd.bdate_range("2020-01-01", periods=120)
    vix = pd.Series(np.linspace(15, 30, 120), index=idx)
    labels = pd.Series(["Calm"] * 60 + ["Panic"] * 60, index=idx)
    out = calibrate_by_regime(vix, labels)
    assert out["Calm"]["n"] == 60 and out["Panic"]["n"] == 59


# ---------------------------------------------------------------------------- validation
def test_spike_days_definition() -> None:
    vix = pd.Series(
        [10, 10, 10, 13, 10, 10, 10, 10.0], index=pd.bdate_range("2020-01-01", periods=8)
    )
    s = spike_days(vix, 0.30, 2)
    assert s.tolist()[:3] == [0.0, 1.0, 1.0]
    assert np.isnan(s.iloc[-1]) and np.isnan(s.iloc[-2])


def test_spike_lead_time_metrics() -> None:
    idx = pd.bdate_range("2020-01-01", periods=6)
    labels = pd.Series(["Calm", "Stressed", "Stressed", "Calm", "Calm", "Panic"], index=idx)
    spikes = pd.Series([0, 0, 1, 0, 1, 0.0], index=idx)
    r = spike_lead_time(labels, spikes)
    assert r["spike_days"] == 2 and r["spike_events"] == 2
    assert r["hit_rate"] == pytest.approx(0.5)
    assert r["false_alarm_rate"] == pytest.approx(2 / 4)
    assert r["median_days_flagged_before_event"] == pytest.approx(1.0)  # leads 2 and 0


def test_known_episodes_in_sample_flag() -> None:
    idx = pd.bdate_range("2008-01-01", "2024-12-31")
    labels = pd.Series("Panic", index=idx)
    rows = known_episodes({"hmm": labels}, "2013-12-31", 0.5)
    assert [r["in_sample"] for r in rows] == [True, True, True, False, False, False, False]
    assert all(r["hmm"]["share_flagged"] == 1.0 and r["hmm"]["passed"] for r in rows)


def test_run_validation_on_walk_forward(wf) -> None:
    _, hist, _, _, _ = wf
    v = run_validation(hist, NAMES, CFG)
    assert v["oos_start"] > "2009-12-31"
    assert {r["check"] for r in v["summary"]} >= {
        "Spike hit rate (days)",
        "Flips per year (smoothed)",
    }
    json.dumps(v)  # serialisable
    assert v["stability"]["hmm_smoothed_flips_per_year"] <= v["stability"]["hmm_raw_flips_per_year"]


def test_walk_forward_has_no_look_ahead(wf) -> None:
    """Appending later data must not change any earlier walk-forward output."""
    feats, hist, _, _, _ = wf
    cut = feats.index[feats.index <= "2011-06-30"]
    short, _, _ = run_walk_forward(feats.loc[cut], CFG, out_dir=None, n_jobs=1)
    cols = ["p_calm", "p_stressed", "p_panic"]
    np.testing.assert_allclose(short[cols].to_numpy(), hist.loc[cut, cols].to_numpy(), atol=1e-10)
    assert (short["smoothed_label"] == hist.loc[cut, "smoothed_label"]).all()


def test_validation_oos_checks_ignore_in_sample_rows(wf) -> None:
    _, hist, _, _, _ = wf
    base = run_validation(hist, NAMES, CFG)
    tampered = hist.copy()
    ins = tampered["in_sample"]
    tampered.loc[ins, "smoothed_label"] = "Panic"
    tampered.loc[ins, "uvxy_close"] = tampered.loc[ins, "uvxy_close"] * 3
    v = run_validation(tampered, NAMES, CFG)
    for key in ("stability", "durations", "label_share", "calm_share_year"):
        assert v[key] == base[key]


def test_calibrate_by_regime_uses_full_calendar_for_next_level() -> None:
    idx = pd.bdate_range("2020-01-01", periods=100)
    vix = pd.Series(np.exp(np.linspace(2.5, 3.0, 100)), index=idx)
    labels = pd.Series("Calm", index=idx[::2])  # every other day
    out = calibrate_by_regime(vix, labels)
    step = np.log(vix.iloc[1] / vix.iloc[0])
    assert out["Calm"]["mean_daily_log_change"] == pytest.approx(step)


def test_service_train_writes_full_artifact_set(tmp_path, monkeypatch) -> None:
    from app.core.config import Settings
    from app.regime import service

    s = Settings(data_dir=tmp_path, regime=CFG)
    panel = make_panel(n=1400, seed=5)
    panel.attrs = {}
    monkeypatch.setattr(service, "load_panel", lambda: panel.copy())
    service.train(s, n_jobs=1)
    names = {p.name for p in s.regime_dir.iterdir()}
    assert {
        "history.parquet",
        "live.parquet",
        "live_model.joblib",
        "risk_stats.json",
        "vix_params.json",
        "validation.json",
        "train_summary.json",
    } <= names
    assert any(n.startswith("fold_") and n.endswith(".json") for n in names)
    assert not s.regime_dir.with_name("regime.staging").exists()
    for f in s.regime_dir.glob("*.json"):
        assert "NaN" not in f.read_text(), f.name
        json.loads(f.read_text())
    # Retrain replaces artifacts wholesale (no stale folds survive).
    (s.regime_dir / "fold_1999-12-31.json").write_text("{}")
    service.train(s, n_jobs=1)
    assert not (s.regime_dir / "fold_1999-12-31.json").exists()


def test_compare_ties_noise_and_flags_shared_failures() -> None:
    from app.regime.validation import compare

    assert compare(0.088, 0.083, True) == "tie"  # within 10%
    assert compare(0.615, 0.410, True) == "hmm"
    assert compare(58.7, 41.8, False) == "baseline"
    assert compare(-0.0009, -0.0022, True, must_be_positive=True) == "neither"
    assert compare(0.001, -0.002, True, must_be_positive=True) == "hmm"
    assert compare(None, 1.0, True) is None
