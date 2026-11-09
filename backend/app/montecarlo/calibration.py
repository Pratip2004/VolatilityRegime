"""Spot-VIX process calibration, matching the Monte Carlo simulator's one-factor model.

The simulator (sibling project ``MonteCarlo``, ``app/models/vix_process.py``) uses

    x[t+1] = ln(theta) + b (x[t] - ln(theta)) + sigma sqrt(dt) Z + J N,   b = exp(-kappa dt)
    N ~ Bernoulli(lam dt),  J ~ Normal(mu_j, sigma_j),  dt = 1/252,  x = ln VIX

and calibrates it (``app/calibration/calibrate.py::fit_spot_process``) by an AR(1)
``x[t+1] = a + b x[t] + e`` fitted by OLS on non-jump days, flagging residuals above
``k * std`` as jumps and refitting until the jump set is stable. This module re-implements
that procedure on explicit (level, next level) pairs so it can be applied to the days of one
regime only. Units: kappa and lam per year; theta in VIX points; sigma per sqrt(year) and
mu_j, sigma_j in log units. Field names match the simulator's ``ParamOverrides``.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.core.config import JumpConfig

TRADING_DAYS = 252.0
MIN_PAIRS = 30


def _empty(n: int) -> dict:
    return {
        "n": int(n),
        "kappa": None,
        "theta": None,
        "sigma": None,
        "lam": None,
        "mu_j": None,
        "sigma_j": None,
        "jumps": None,
        "half_life_days": None,
        "mean_daily_log_change": None,
        "std_daily_log_change": None,
    }


def calibrate_log_ou(
    level: np.ndarray, next_level: np.ndarray, jump: JumpConfig | None = None
) -> dict:
    """Fit the simulator's log-OU + Poisson-jump model to (VIX[t], VIX[t+1]) pairs."""
    jump = jump or JumpConfig()
    x0 = np.log(np.asarray(level, dtype=float))
    x1 = np.log(np.asarray(next_level, dtype=float))
    ok = np.isfinite(x0) & np.isfinite(x1)
    x0, x1 = x0[ok], x1[ok]
    n = len(x0)
    if n < MIN_PAIRS:
        return _empty(n)

    jumps = np.zeros(n, dtype=bool)
    a = b = sd = float("nan")
    resid = np.zeros(n)
    for _ in range(jump.max_iter):
        keep = ~jumps
        design = np.column_stack([np.ones(keep.sum()), x0[keep]])
        (a, b), *_ = np.linalg.lstsq(design, x1[keep], rcond=None)
        resid = x1 - a - b * x0
        sd = float(resid[keep].std(ddof=2))
        new = (
            resid > jump.threshold_k * sd
            if jump.side == "up"
            else np.abs(resid) > (jump.threshold_k * sd)
        )
        if np.array_equal(new, jumps):
            break
        jumps = new

    change = x1 - x0
    out = _empty(n) | {
        "sigma": float(sd * np.sqrt(TRADING_DAYS)),
        "lam": float(jumps.sum() / (n / TRADING_DAYS)),
        "mu_j": float(resid[jumps].mean()) if jumps.any() else 0.0,
        "sigma_j": float(resid[jumps].std(ddof=1)) if jumps.sum() > 1 else 0.0,
        "jumps": int(jumps.sum()),
        "mean_daily_log_change": float(change.mean()),
        "std_daily_log_change": float(change.std(ddof=1)),
    }
    if 0 < b < 1:  # mean-reverting fit: exact OU mapping, as in the simulator
        log_theta = a / (1 - b)
        out["kappa"] = float(-np.log(b) * TRADING_DAYS)
        out["theta"] = float(np.exp(log_theta)) if log_theta < 50 else None
        out["half_life_days"] = float(np.log(2) / -np.log(b))
    return out


def calibrate_spot_vix(vix: pd.Series, jump: JumpConfig | None = None) -> dict:
    """Calibrate on a whole VIX series (consecutive trading days)."""
    v = vix.dropna().to_numpy()
    return calibrate_log_ou(v[:-1], v[1:], jump)


def calibrate_by_regime(
    vix: pd.Series, labels: pd.Series, jump: JumpConfig | None = None
) -> dict[str, dict]:
    """Per-regime parameters using transitions (t → t+1) where the label at close ``t`` is the
    regime. ``vix`` should cover the full trading calendar: the next level is taken from it, so
    a label subset never pairs non-adjacent days."""
    nxt = vix.shift(-1).reindex(labels.index)
    level = vix.reindex(labels.index)
    out = {}
    for name in pd.unique(labels.dropna()):
        mask = (labels == name).to_numpy()
        out[str(name)] = calibrate_log_ou(level.to_numpy()[mask], nxt.to_numpy()[mask], jump)
    return out
