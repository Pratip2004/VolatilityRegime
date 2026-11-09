"""Rule-based baseline regime labels for comparison with the HMM.

- Panic if ``vx1 > vx2`` (backwardation)
- Calm if ``contango > calm_min_contango`` and ``vix_ratio < calm_max_vix_ratio``
- Stressed otherwise
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.core.config import BaselineConfig


def baseline_labels(df: pd.DataFrame, cfg: BaselineConfig | None = None) -> pd.Series:
    """``df`` needs ``vx1, vx2, vix, vix3m``. Uses same-day values only."""
    cfg = cfg or BaselineConfig()
    contango = df["vx2"] / df["vx1"] - 1.0
    vix_ratio = df["vix"] / df["vix3m"]
    panic = df["vx1"] > df["vx2"]
    calm = (contango > cfg.calm_min_contango) & (vix_ratio < cfg.calm_max_vix_ratio)
    labels = np.where(panic, "Panic", np.where(calm, "Calm", "Stressed"))
    return pd.Series(labels, index=df.index, name="baseline_label", dtype=object)
