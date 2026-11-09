"""Gaussian HMM regime model.

- Multi-restart fitting (seeds 0..n_restarts-1), keep the best training log-likelihood.
- Filtered probabilities via a log-space forward algorithm. ``hmmlearn``'s ``predict_proba`` is
  smoothed (uses future data) and is only exposed as ``smoothed_proba`` for the hindsight view.
- States are named by mean contango (original units) over training days where each state has the
  highest filtered probability: highest = Calm, middle = Stressed, lowest = Panic.
"""

from __future__ import annotations

import logging
import warnings
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from hmmlearn.hmm import GaussianHMM
from scipy.special import logsumexp
from scipy.stats import multivariate_normal
from sklearn.preprocessing import StandardScaler

from app.core.config import RegimeConfig

log = logging.getLogger(__name__)

STATE_NAMES_BY_N: dict[int, tuple[str, ...]] = {
    2: ("Calm", "Panic"),
    3: ("Calm", "Stressed", "Panic"),
    4: ("Calm", "Elevated", "Stressed", "Panic"),
}


def state_names(n_states: int) -> tuple[str, ...]:
    return STATE_NAMES_BY_N[n_states]


def prob_column(name: str) -> str:
    return f"p_{name.lower()}"


# --------------------------------------------------------------------------------------------
# Low-level HMM maths (operate on raw state indices)
# --------------------------------------------------------------------------------------------


def emission_logprob(x: np.ndarray, means: np.ndarray, covars: np.ndarray) -> np.ndarray:
    """(T, K) log-densities of each observation under each state's Gaussian."""
    x = np.atleast_2d(x)
    return np.column_stack(
        [
            multivariate_normal(mean=means[k], cov=covars[k], allow_singular=True).logpdf(x)
            for k in range(len(means))
        ]
    ).reshape(len(x), len(means))


def forward_filter(
    x: np.ndarray,
    startprob: np.ndarray,
    transmat: np.ndarray,
    means: np.ndarray,
    covars: np.ndarray,
    prev_log_alpha: np.ndarray | None = None,
) -> np.ndarray:
    """Normalised log filtered state probabilities ``log P(s_t | x_1..x_t)``, shape (T, K).

    If ``prev_log_alpha`` (normalised log filtered probabilities of the day before ``x[0]``) is
    given, the recursion continues from it instead of starting from ``startprob``.
    """
    log_em = emission_logprob(x, means, covars)
    with np.errstate(divide="ignore"):
        log_a = np.log(transmat)
        log_start = np.log(startprob)
    t_len, k = log_em.shape
    log_alpha = np.empty((t_len, k))
    prior = log_start if prev_log_alpha is None else logsumexp(prev_log_alpha[:, None] + log_a, 0)
    for t in range(t_len):
        if t > 0:
            prior = logsumexp(log_alpha[t - 1][:, None] + log_a, axis=0)
        a = prior + log_em[t]
        log_alpha[t] = a - logsumexp(a)
    return log_alpha


def fit_hmm_restarts(
    x: np.ndarray, cfg: RegimeConfig, seeds: list[int] | None = None
) -> tuple[GaussianHMM, list[dict]]:
    """Fit ``GaussianHMM`` from several random seeds; return the best model and every score."""
    seeds = list(range(cfg.n_restarts)) if seeds is None else seeds
    best: GaussianHMM | None = None
    best_score = -np.inf
    restarts: list[dict] = []
    for seed in seeds:
        model = GaussianHMM(
            n_components=cfg.n_states,
            covariance_type="full",
            n_iter=cfg.n_iter,
            min_covar=cfg.min_covar,
            tol=cfg.tol,
            random_state=seed,
        )
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            logging.getLogger("hmmlearn").setLevel(logging.ERROR)
            try:
                model.fit(x)
                score = float(model.score(x))
            except (ValueError, np.linalg.LinAlgError) as exc:
                log.warning("restart seed=%d failed: %s", seed, exc)
                restarts.append({"seed": seed, "log_likelihood": None, "converged": False})
                continue
        converged = bool(model.monitor_.converged)
        restarts.append({"seed": seed, "log_likelihood": score, "converged": converged})
        log.info("HMM restart seed=%d loglik=%.2f converged=%s", seed, score, converged)
        if score > best_score:
            best, best_score = model, score
    if best is None:
        raise RuntimeError("all HMM restarts failed")
    return best, restarts


def permute_hmm(model: GaussianHMM, perm: np.ndarray) -> GaussianHMM:
    """Return a copy of ``model`` whose state ``i`` is the original state ``perm[i]``."""
    new = GaussianHMM(n_components=model.n_components, covariance_type="full")
    new.startprob_ = model.startprob_[perm]
    new.transmat_ = model.transmat_[np.ix_(perm, perm)]
    new.means_ = model.means_[perm]
    new.covars_ = model.covars_[perm]
    new.n_features = model.n_features
    return new


# --------------------------------------------------------------------------------------------
# Regime model (named states, scaler, metadata)
# --------------------------------------------------------------------------------------------


@dataclass
class RegimeModel:
    hmm: GaussianHMM
    scaler: StandardScaler
    features: list[str]
    names: tuple[str, ...]
    #: ``order[i]`` = raw HMM state index of ``names[i]``.
    order: list[int]
    train_start: str
    train_end: str
    n_train: int
    log_likelihood: float
    restarts: list[dict] = field(default_factory=list)
    #: Normalised log filtered probabilities (raw-index order) on the last training day.
    last_log_alpha: np.ndarray | None = None
    label_contango: dict[str, float] = field(default_factory=dict)

    # ---- matrices in name order ------------------------------------------------------------
    @property
    def transmat(self) -> np.ndarray:
        return self.hmm.transmat_[np.ix_(self.order, self.order)]

    @property
    def startprob(self) -> np.ndarray:
        return self.hmm.startprob_[self.order]

    def transmat_df(self) -> pd.DataFrame:
        return pd.DataFrame(self.transmat, index=list(self.names), columns=list(self.names))

    def state_means(self) -> pd.DataFrame:
        """State means in original (unscaled) feature units, rows in name order."""
        means = self.scaler.inverse_transform(self.hmm.means_[self.order])
        return pd.DataFrame(means, index=list(self.names), columns=self.features)

    def state_stds(self) -> pd.DataFrame:
        """Per-feature std of each state's Gaussian, original units."""
        variances = np.array([np.diag(self.hmm.covars_[i]) for i in self.order])
        stds = np.sqrt(variances) * self.scaler.scale_
        return pd.DataFrame(stds, index=list(self.names), columns=self.features)

    # ---- inference ---------------------------------------------------------------------------
    def _scaled(self, df: pd.DataFrame) -> np.ndarray:
        return self.scaler.transform(df[self.features].to_numpy(dtype=float))

    def filtered_log_alpha(
        self, df: pd.DataFrame, prev_log_alpha: np.ndarray | None = None
    ) -> np.ndarray:
        h = self.hmm
        return forward_filter(
            self._scaled(df), h.startprob_, h.transmat_, h.means_, h.covars_, prev_log_alpha
        )

    def filtered_proba(
        self, df: pd.DataFrame, prev_log_alpha: np.ndarray | None = None
    ) -> pd.DataFrame:
        """Filtered (no look-ahead) probabilities, columns ``p_<name>`` in name order."""
        log_alpha = self.filtered_log_alpha(df, prev_log_alpha)
        return self._named(np.exp(log_alpha), df.index)

    def smoothed_proba(self, df: pd.DataFrame) -> pd.DataFrame:
        """Hindsight (forward-backward) probabilities. Uses future data: diagnostics only."""
        return self._named(self.hmm.predict_proba(self._scaled(df)), df.index)

    def _named(self, probs: np.ndarray, index: pd.Index) -> pd.DataFrame:
        cols = [prob_column(n) for n in self.names]
        return pd.DataFrame(probs[:, self.order], index=index, columns=cols)

    # ---- forecasting -------------------------------------------------------------------------
    def forecast(self, p_today: np.ndarray, horizon: int) -> np.ndarray:
        return forecast_probs(p_today, self.transmat, horizon)

    def expected_duration(self) -> dict[str, float]:
        diag = np.diag(self.transmat)
        return {n: float(1.0 / max(1.0 - d, 1e-12)) for n, d in zip(self.names, diag, strict=True)}

    def metadata(self) -> dict:
        return {
            "features": self.features,
            "names": list(self.names),
            "order": [int(i) for i in self.order],
            "state_mapping": {str(int(i)): n for n, i in zip(self.names, self.order, strict=True)},
            "train_start": self.train_start,
            "train_end": self.train_end,
            "n_train": self.n_train,
            "log_likelihood": self.log_likelihood,
            "restarts": self.restarts,
            "label_contango": self.label_contango,
            "scaler": {
                "mean": self.scaler.mean_.tolist(),
                "scale": self.scaler.scale_.tolist(),
            },
        }


def forecast_probs(p_today: np.ndarray, transmat: np.ndarray, horizon: int) -> np.ndarray:
    """``p[t+h] = p[t] @ transmat^h``; works for a single vector or a (T, K) matrix."""
    if horizon < 0:
        raise ValueError("horizon must be >= 0")
    out = np.asarray(p_today, dtype=float) @ np.linalg.matrix_power(transmat, horizon)
    return out / out.sum(axis=-1, keepdims=True)


def label_states(
    hmm: GaussianHMM,
    x_scaled: np.ndarray,
    contango: np.ndarray,
    names: tuple[str, ...],
    contango_mean_fallback: np.ndarray,
) -> tuple[list[int], dict[str, float]]:
    """Order raw state indices by mean contango (descending) → names.

    Mean contango per state is over training days where the state has the highest filtered
    probability; a state that never wins falls back to its Gaussian mean (original units).
    """
    log_alpha = forward_filter(x_scaled, hmm.startprob_, hmm.transmat_, hmm.means_, hmm.covars_)
    winner = log_alpha.argmax(axis=1)
    k = hmm.n_components
    mean_c = np.array(
        [
            contango[winner == s].mean() if (winner == s).any() else contango_mean_fallback[s]
            for s in range(k)
        ]
    )
    # Stable sort with index tiebreak keeps the result independent of state order only when
    # means differ, which is the generic case.
    order = [int(i) for i in np.argsort(-mean_c, kind="stable")]
    return order, {names[i]: float(mean_c[s]) for i, s in enumerate(order)}


def fit_regime_model(
    features: pd.DataFrame,
    cfg: RegimeConfig,
    seeds: list[int] | None = None,
) -> RegimeModel:
    """Fit scaler + HMM on ``features`` (already restricted to the training window)."""
    if len(features) < 50:
        raise ValueError(f"need at least 50 training rows, got {len(features)}")
    cols = list(cfg.features)
    raw = features[cols].to_numpy(dtype=float)
    scaler = StandardScaler().fit(raw)
    x = scaler.transform(raw)
    hmm, restarts = fit_hmm_restarts(x, cfg, seeds)
    names = state_names(cfg.n_states)
    c_idx = cols.index("contango")
    fallback = scaler.inverse_transform(hmm.means_)[:, c_idx]
    order, label_c = label_states(hmm, x, raw[:, c_idx], names, fallback)
    log_alpha = forward_filter(x, hmm.startprob_, hmm.transmat_, hmm.means_, hmm.covars_)
    return RegimeModel(
        hmm=hmm,
        scaler=scaler,
        features=cols,
        names=names,
        order=order,
        train_start=features.index.min().date().isoformat(),
        train_end=features.index.max().date().isoformat(),
        n_train=len(features),
        log_likelihood=float(hmm.score(x)),
        restarts=restarts,
        last_log_alpha=log_alpha[-1],
        label_contango=label_c,
    )
