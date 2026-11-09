from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from hmmlearn.hmm import GaussianHMM

from app.core.config import HysteresisConfig, RegimeConfig
from app.regime.baseline import baseline_labels
from app.regime.features import build_features
from app.regime.hmm_model import (
    fit_hmm_restarts,
    fit_regime_model,
    forecast_probs,
    forward_filter,
    label_states,
    permute_hmm,
)
from app.regime.smoothing import days_in_regime, flips_per_year, smooth_labels, spells

FAST = RegimeConfig(n_restarts=3, n_iter=200)
NAMES = ("Calm", "Stressed", "Panic")


@pytest.fixture(scope="module")
def fitted():
    from tests.conftest import make_panel

    feats = build_features(make_panel(n=1400, seed=1), FAST)
    train = feats.iloc[:700]
    return feats, fit_regime_model(train, FAST)


# ---------------------------------------------------------------------------- no look-ahead
def test_filtered_probs_have_no_look_ahead(fitted) -> None:
    feats, model = fitted
    cut = 900
    full = model.filtered_proba(feats)
    trunc = model.filtered_proba(feats.iloc[:cut])
    pd.testing.assert_frame_equal(full.iloc[:cut], trunc, rtol=0, atol=1e-12)


def test_filter_continuation_matches_single_pass(fitted) -> None:
    feats, model = fitted
    one_pass = model.filtered_proba(feats)
    first = model.filtered_log_alpha(feats.iloc[:500])
    second = model.filtered_proba(feats.iloc[500:], prev_log_alpha=first[-1])
    np.testing.assert_allclose(one_pass.iloc[500:].to_numpy(), second.to_numpy(), atol=1e-10)


def test_filtered_differs_from_smoothed(fitted) -> None:
    feats, model = fitted
    f = model.filtered_proba(feats)
    s = model.smoothed_proba(feats)
    np.testing.assert_allclose(f.sum(axis=1), 1.0, atol=1e-9)
    assert not np.allclose(f.to_numpy(), s.to_numpy(), atol=1e-6)
    # On the last day forward-backward reduces to the forward pass.
    np.testing.assert_allclose(f.iloc[-1].to_numpy(), s.iloc[-1].to_numpy(), atol=1e-6)


def test_forward_filter_matches_hmmlearn_on_last_day() -> None:
    rng = np.random.default_rng(3)
    hmm = _true_hmm()
    x, _ = hmm.sample(400, random_state=rng.integers(1e6))
    la = forward_filter(x, hmm.startprob_, hmm.transmat_, hmm.means_, hmm.covars_)
    np.testing.assert_allclose(np.exp(la[-1]), hmm.predict_proba(x)[-1], atol=1e-8)


# ---------------------------------------------------------------------------- recovery
def _true_hmm() -> GaussianHMM:
    h = GaussianHMM(n_components=3, covariance_type="full")
    h.startprob_ = np.array([0.6, 0.3, 0.1])
    h.transmat_ = np.array([[0.97, 0.025, 0.005], [0.05, 0.92, 0.03], [0.03, 0.12, 0.85]])
    h.means_ = np.array([[2.0, -1.0], [0.0, 0.5], [-3.0, 2.5]])
    h.covars_ = np.array([np.eye(2) * 0.3, np.eye(2) * 0.4, np.eye(2) * 0.6])
    h.n_features = 2
    return h


def test_recovers_known_hmm() -> None:
    true = _true_hmm()
    x, _ = true.sample(4000, random_state=7)
    cfg = RegimeConfig(n_restarts=4, n_iter=300)
    fit, _ = fit_hmm_restarts(x, cfg)
    # Align labels by the first mean coordinate (descending, like contango).
    order_fit = np.argsort(-fit.means_[:, 0])
    order_true = np.argsort(-true.means_[:, 0])
    np.testing.assert_allclose(fit.means_[order_fit], true.means_[order_true], atol=0.15)
    a_fit = fit.transmat_[np.ix_(order_fit, order_fit)]
    a_true = true.transmat_[np.ix_(order_true, order_true)]
    np.testing.assert_allclose(a_fit, a_true, atol=0.04)


def test_restart_log_is_complete() -> None:
    x, _ = _true_hmm().sample(600, random_state=1)
    _, restarts = fit_hmm_restarts(x, RegimeConfig(n_restarts=3, n_iter=50))
    assert [r["seed"] for r in restarts] == [0, 1, 2]
    assert all(r["log_likelihood"] is not None for r in restarts)


# ---------------------------------------------------------------------------- labelling
def test_labels_ordered_by_contango(fitted) -> None:
    _, model = fitted
    c = model.state_means()["contango"]
    assert c["Calm"] > c["Stressed"] > c["Panic"]
    lc = model.label_contango
    assert lc["Calm"] > lc["Stressed"] > lc["Panic"]


@pytest.mark.parametrize("perm", [[2, 0, 1], [1, 2, 0], [2, 1, 0]])
def test_permuting_states_gives_same_names(fitted, perm) -> None:
    feats, model = fitted
    train = feats.iloc[:700]
    x = model.scaler.transform(train[model.features].to_numpy())
    contango = train["contango"].to_numpy()
    fb = model.scaler.inverse_transform(model.hmm.means_)[:, 0]
    permuted = permute_hmm(model.hmm, np.array(perm))
    order_p, lc_p = label_states(permuted, x, contango, NAMES, fb[perm])
    # Same named means → same names regardless of raw state order.
    np.testing.assert_allclose(permuted.means_[order_p], model.hmm.means_[model.order])
    assert lc_p == pytest.approx(model.label_contango)


def test_true_regimes_are_recovered_on_synthetic_panel(fitted) -> None:
    from tests.conftest import make_panel

    feats, model = fitted
    panel = make_panel(n=1400, seed=1)
    truth = pd.Series(panel.attrs["true_states"], index=panel["date"]).reindex(feats.index)
    pred = model.filtered_proba(feats).to_numpy().argmax(axis=1)
    assert (pred == truth.to_numpy()).mean() > 0.85


# ---------------------------------------------------------------------------- forecast
def test_forecast_rows_sum_to_one_and_h0_identity(fitted) -> None:
    _, model = fitted
    p = np.array([0.2, 0.5, 0.3])
    np.testing.assert_allclose(model.forecast(p, 0), p)
    for h in (1, 5, 20, 250):
        f = model.forecast(p, h)
        assert f.sum() == pytest.approx(1.0)
        assert (f >= 0).all()
    np.testing.assert_allclose(model.forecast(p, 1), p @ model.transmat)
    mat = forecast_probs(np.array([[1, 0, 0], [0, 0, 1.0]]), model.transmat, 5)
    np.testing.assert_allclose(mat.sum(axis=1), 1.0)
    with pytest.raises(ValueError):
        model.forecast(p, -1)


def test_expected_duration(fitted) -> None:
    _, model = fitted
    d = model.expected_duration()
    for i, n in enumerate(model.names):
        assert d[n] == pytest.approx(1 / (1 - model.transmat[i, i]))


def test_transmat_rows_sum_to_one(fitted) -> None:
    _, model = fitted
    np.testing.assert_allclose(model.transmat.sum(axis=1), 1.0)


# ---------------------------------------------------------------------------- hysteresis
def _probs(rows: list[tuple[float, float, float]]) -> pd.DataFrame:
    return pd.DataFrame(rows, columns=["p_calm", "p_stressed", "p_panic"])


def test_hysteresis_sequences() -> None:
    p = _probs(
        [
            (0.80, 0.15, 0.05),  # first day: raw → Calm
            (0.45, 0.50, 0.05),  # Stressed only 0.50 < 0.60 → keep Calm
            (0.30, 0.65, 0.05),  # Stressed ≥ 0.60 → Stressed
            (0.10, 0.25, 0.65),  # Panic 0.65 < 0.70 → keep Stressed
            (0.05, 0.20, 0.75),  # Panic ≥ 0.70 → Panic
            (0.30, 0.25, 0.45),  # Panic 0.45 ≥ 0.40 → stay Panic
            (0.65, 0.00, 0.35),  # Panic < 0.40 and Calm ≥ 0.60 → Calm
        ]
    )
    got = smooth_labels(p, NAMES).tolist()
    assert got == ["Calm", "Calm", "Stressed", "Stressed", "Panic", "Panic", "Calm"]


def test_leaving_panic_defaults_to_stressed() -> None:
    p = _probs([(0.0, 0.1, 0.9), (0.35, 0.30, 0.35)])
    assert smooth_labels(p, NAMES).tolist() == ["Panic", "Stressed"]


def test_hysteresis_uses_config_and_initial() -> None:
    p = _probs([(0.55, 0.40, 0.05)])
    assert smooth_labels(p, NAMES, initial="Stressed").tolist() == ["Stressed"]
    cfg = HysteresisConfig(enter_calm=0.5)
    assert smooth_labels(p, NAMES, cfg, initial="Stressed").tolist() == ["Calm"]


def test_hysteresis_reduces_flips() -> None:
    rng = np.random.default_rng(0)
    raw = rng.dirichlet([1, 1, 1], size=500)
    p = pd.DataFrame(raw, columns=["p_calm", "p_stressed", "p_panic"])
    from app.regime.smoothing import raw_labels

    assert flips_per_year(smooth_labels(p, NAMES)) < flips_per_year(raw_labels(p, NAMES))


def test_days_in_regime_and_spells() -> None:
    labels = pd.Series(["Calm", "Calm", "Panic", "Panic", "Panic", "Calm"])
    assert days_in_regime(labels).tolist() == [1, 2, 1, 2, 3, 1]
    assert days_in_regime(labels, initial_count=4, initial="Calm").tolist()[:2] == [5, 6]
    sp = spells(labels)
    assert sp["label"].tolist() == ["Calm", "Panic", "Calm"]
    assert sp["length"].tolist() == [2, 3, 1]


# ---------------------------------------------------------------------------- baseline
def test_baseline_rules() -> None:
    df = pd.DataFrame(
        {
            "vx1": [20.0, 20.0, 20.0, 20.0],
            "vx2": [19.0, 21.2, 21.2, 20.5],
            "vix": [30.0, 15.0, 19.5, 15.0],
            "vix3m": [25.0, 18.0, 20.0, 18.0],
        }
    )
    # backwardation; contango 6% & ratio .83; contango 6% & ratio .975; contango 2.5%
    assert baseline_labels(df).tolist() == ["Panic", "Calm", "Stressed", "Stressed"]
