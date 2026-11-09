"""Regime features. Every value at day ``t`` uses panel data up to and including ``t`` only.

Warm-up uses panel history before ``analysis_start`` (the panel starts 2007-01), so the first
feature row is close to 2008-01-01 and the 2008 crisis is covered. Rows with any NaN feature are
dropped.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from numpy.lib.stride_tricks import sliding_window_view

from app.core.config import ALL_FEATURES, RegimeConfig

# Panel columns carried alongside the features for downstream use (charts, risk stats, baseline).
CONTEXT_COLUMNS = ["vix", "vix3m", "vvix", "vx1", "vx2", "spx_close", "uvxy_close"]


def rolling_percentile_rank(x: pd.Series, window: int) -> pd.Series:
    """Share of the trailing ``window`` values (including today) that are <= today's value."""
    values = x.to_numpy(dtype=float)
    out = np.full(len(values), np.nan)
    if len(values) >= window:
        win = sliding_window_view(values, window)
        last = win[:, -1:]
        ranks = (win <= last).mean(axis=1)
        ranks[np.isnan(win).any(axis=1)] = np.nan
        out[window - 1 :] = ranks
    return pd.Series(out, index=x.index, name=x.name)


def compute_all_features(panel: pd.DataFrame, cfg: RegimeConfig | None = None) -> pd.DataFrame:
    """All six features for every panel row (NaNs kept). Indexed by date."""
    cfg = cfg or RegimeConfig()
    p = panel.set_index("date").sort_index() if "date" in panel.columns else panel.sort_index()
    out = pd.DataFrame(index=p.index)
    out["contango"] = p["vx2"] / p["vx1"] - 1.0
    out["vix_ratio"] = p["vix"] / p["vix3m"]
    out["log_vvix"] = np.log(p["vvix"])
    log_ret = np.log(p["spx_close"]).diff()
    out["rv20"] = log_ret.rolling(cfg.rv_window).std() * np.sqrt(252.0)
    out["vix_pct_252"] = rolling_percentile_rank(p["vix"], cfg.pct_window)
    out["d_contango_5"] = out["contango"] - out["contango"].shift(cfg.d_contango_lag)
    return out[list(ALL_FEATURES)]


def build_features(panel: pd.DataFrame, cfg: RegimeConfig | None = None) -> pd.DataFrame:
    """Feature matrix for the model: configured features from ``analysis_start``, warm-up rows
    dropped, plus the context columns. Indexed by date."""
    cfg = cfg or RegimeConfig()
    feats = compute_all_features(panel, cfg)
    p = panel.set_index("date").sort_index() if "date" in panel.columns else panel.sort_index()
    df = feats[cfg.features].join(p[CONTEXT_COLUMNS])
    df = df[df.index >= pd.Timestamp(cfg.analysis_start)]
    return df.dropna(subset=cfg.features)


def feature_summary(features: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    return features[cols].describe(percentiles=[0.01, 0.5, 0.99]).T
