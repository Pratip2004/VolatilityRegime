"""Spot-VIX process calibration.

Model: mean-reverting log-VIX (discretised Ornstein-Uhlenbeck),
``ln VIX[t+1] - ln VIX[t] = kappa * dt * (ln theta - ln VIX[t]) + sigma * sqrt(dt) * eps``,
fitted by OLS of daily log changes on the log level. ``dt = 1/252``.

``calibrate_log_ou`` takes explicit (level, next-level) pairs so it can be applied to any subset of
days, e.g. only days in a given regime.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

DT = 1.0 / 252.0


def calibrate_log_ou(level: np.ndarray, next_level: np.ndarray) -> dict:
    x = np.log(np.asarray(level, dtype=float))
    y = np.log(np.asarray(next_level, dtype=float)) - x
    ok = np.isfinite(x) & np.isfinite(y)
    x, y = x[ok], y[ok]
    n = len(x)
    if n < 10:
        return {
            "n": n,
            "kappa": None,
            "theta": None,
            "sigma": None,
            "mean_daily_log_change": None,
            "std_daily_log_change": None,
        }
    a, b = _ols(x, y)
    resid = y - (a + b * x)
    sigma = float(resid.std(ddof=2) / np.sqrt(DT))
    kappa = float(-b / DT)
    theta = float(np.exp(-a / b)) if b < 0 else None
    return {
        "n": int(n),
        "kappa": kappa,
        "theta": theta,
        "sigma": sigma,
        "half_life_days": float(np.log(2) / (-b)) if b < 0 else None,
        "mean_daily_log_change": float(y.mean()),
        "std_daily_log_change": float(y.std(ddof=1)),
    }


def _ols(x: np.ndarray, y: np.ndarray) -> tuple[float, float]:
    xm, ym = x.mean(), y.mean()
    var = ((x - xm) ** 2).sum()
    b = float(((x - xm) * (y - ym)).sum() / var) if var > 0 else 0.0
    return float(ym - b * xm), b


def calibrate_spot_vix(vix: pd.Series) -> dict:
    """Calibrate on a whole VIX series (consecutive trading days)."""
    v = vix.dropna().to_numpy()
    return calibrate_log_ou(v[:-1], v[1:])


def calibrate_by_regime(vix: pd.Series, labels: pd.Series) -> dict[str, dict]:
    """Per-regime parameters using transitions (t → t+1) where the label at close ``t`` is the
    regime. ``vix`` should cover the full trading calendar: the next level is taken from it, so
    a label subset never pairs non-adjacent days."""
    nxt = vix.shift(-1).reindex(labels.index)
    level = vix.reindex(labels.index)
    out = {}
    for name in pd.unique(labels.dropna()):
        mask = (labels == name).to_numpy()
        out[str(name)] = calibrate_log_ou(level.to_numpy()[mask], nxt.to_numpy()[mask])
    return out
