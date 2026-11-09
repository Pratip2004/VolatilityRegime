"""Regime-conditional next-day UVXY risk statistics.

For each regime, using the label at the close of day ``t`` and the UVXY return from close ``t``
to close ``t+1`` (strictly the next trading day). Callers pass out-of-sample history only.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.core.config import JumpConfig
from app.montecarlo.calibration import calibrate_by_regime

PERCENTILES = (1, 5, 25, 75, 95, 99)
MOVE_THRESHOLDS = (0.10, 0.20, 0.30)


def next_day_returns(close: pd.Series) -> pd.Series:
    """Return from close ``t`` to close ``t+1``, aligned at ``t`` (last day NaN)."""
    return (close.shift(-1) / close - 1.0).rename("next_ret")


def _stats(r: np.ndarray) -> dict:
    if len(r) == 0:
        return {"count": 0}
    out = {
        "count": int(len(r)),
        "mean": float(r.mean()),
        "median": float(np.median(r)),
        "std": float(r.std(ddof=1)) if len(r) > 1 else 0.0,
    }
    for q in PERCENTILES:
        out[f"p{q}"] = float(np.percentile(r, q))
    for th in MOVE_THRESHOLDS:
        out[f"prob_up_{int(th * 100)}"] = float((r > th).mean())
        out[f"prob_down_{int(th * 100)}"] = float((r < -th).mean())
    return out


def risk_stats_by_regime(
    labels: pd.Series, close: pd.Series, names: list[str] | tuple[str, ...]
) -> dict[str, dict]:
    """Next-day return stats and empirical next-day regime transition per regime."""
    # Next-day returns come from the full close series, then align to the labelled days, so a
    # label subset (e.g. out-of-sample only) never pairs a day with a non-adjacent close.
    df = pd.DataFrame({"label": labels})
    df["next_ret"] = next_day_returns(close).reindex(labels.index)
    df["next_label"] = _next_on_calendar(labels, close.index)
    out: dict[str, dict] = {}
    for n in names:
        rows = df[df["label"] == n]
        r = rows["next_ret"].dropna().to_numpy()
        stats = _stats(r)
        nl = rows["next_label"].dropna()
        stats["next_regime_prob"] = {m: float((nl == m).mean()) if len(nl) else 0.0 for m in names}
        out[n] = stats
    return out


def _next_on_calendar(labels: pd.Series, calendar: pd.Index) -> pd.Series:
    """Label on the next trading day of ``calendar`` (NaN if that day is unlabelled)."""
    return labels.reindex(calendar).shift(-1).reindex(labels.index)


def empirical_transition_matrix(
    labels: pd.Series, names: list[str] | tuple[str, ...]
) -> pd.DataFrame:
    nxt = labels.shift(-1)
    ok = nxt.notna()
    ct = pd.crosstab(labels[ok], nxt[ok]).reindex(index=names, columns=names, fill_value=0)
    return ct.div(ct.sum(axis=1).replace(0, np.nan), axis=0).fillna(0.0)


def regime_vix_params(
    vix: pd.Series, labels: pd.Series, jump: JumpConfig | None = None
) -> dict[str, dict]:
    """Per-regime spot-VIX process parameters for starting the Monte Carlo simulator."""
    return calibrate_by_regime(vix, labels, jump)
