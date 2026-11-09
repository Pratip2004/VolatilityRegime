"""Raw and hysteresis-smoothed regime labels.

Rules (thresholds from ``HysteresisConfig``):
- Enter Panic when ``p_panic >= enter_panic``.
- While in Panic, stay until ``p_panic < exit_panic``; then go to the most likely non-Panic
  regime that clears its threshold, otherwise Stressed (the conservative choice).
- Switch to Calm / Stressed only when that regime's probability is >= its threshold.
- Otherwise keep the previous smoothed label. The first day takes the raw label.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.core.config import HysteresisConfig

PANIC = "Panic"


def raw_labels(probs: pd.DataFrame, names: list[str] | tuple[str, ...]) -> pd.Series:
    """Argmax of the probability columns (assumed in ``names`` order)."""
    idx = probs.to_numpy().argmax(axis=1)
    return pd.Series(np.asarray(names, dtype=object)[idx], index=probs.index, name="raw_label")


def smooth_labels(
    probs: pd.DataFrame,
    names: list[str] | tuple[str, ...],
    cfg: HysteresisConfig | None = None,
    initial: str | None = None,
) -> pd.Series:
    """Hysteresis labels. ``initial`` is the smoothed label of the day before ``probs`` starts
    (used to continue a sequence across walk-forward folds)."""
    cfg = cfg or HysteresisConfig()
    names = list(names)
    p = probs.to_numpy(dtype=float)
    enter = {n: cfg.enter_stressed for n in names}
    enter.update({"Calm": cfg.enter_calm, "Stressed": cfg.enter_stressed})
    has_panic = PANIC in names
    panic_i = names.index(PANIC) if has_panic else -1
    fallback_exit = "Stressed" if "Stressed" in names else names[0]

    def best_non_panic(row: np.ndarray, exclude: str | None) -> str | None:
        """Highest-probability non-Panic regime (other than ``exclude``) clearing its threshold."""
        for i in np.argsort(-row, kind="stable"):
            n = names[i]
            if n != PANIC and n != exclude and row[i] >= enter[n]:
                return n
        return None

    out: list[str] = []
    prev = initial
    for t in range(len(p)):
        row = p[t]
        if prev is None:
            label = names[int(row.argmax())]
        elif prev == PANIC:
            if row[panic_i] >= cfg.exit_panic:
                label = PANIC
            else:
                label = best_non_panic(row, None) or fallback_exit
        elif has_panic and row[panic_i] >= cfg.enter_panic:
            label = PANIC
        else:
            label = best_non_panic(row, prev) or prev
        out.append(label)
        prev = label
    return pd.Series(out, index=probs.index, name="smoothed_label", dtype=object)


def days_in_regime(
    labels: pd.Series, initial_count: int = 0, initial: str | None = None
) -> pd.Series:
    """Consecutive days (including today) the label has been unchanged."""
    counts = np.empty(len(labels), dtype=int)
    prev, c = initial, initial_count
    for i, lab in enumerate(labels.to_numpy()):
        c = c + 1 if lab == prev else 1
        counts[i] = c
        prev = lab
    return pd.Series(counts, index=labels.index, name="days_in_regime")


def count_flips(labels: pd.Series) -> int:
    v = labels.to_numpy()
    return int((v[1:] != v[:-1]).sum()) if len(v) > 1 else 0


def flips_per_year(labels: pd.Series) -> float:
    """Label changes per 252 trading days."""
    if len(labels) < 2:
        return 0.0
    return count_flips(labels) / (len(labels) / 252.0)


def spells(labels: pd.Series) -> pd.DataFrame:
    """Contiguous runs of the same label: ``label, start, end, length``."""
    if labels.empty:
        return pd.DataFrame(columns=["label", "start", "end", "length"])
    v = labels.to_numpy()
    change = np.r_[True, v[1:] != v[:-1]]
    run_id = np.cumsum(change)
    df = pd.DataFrame({"label": v, "date": labels.index, "run": run_id})
    g = df.groupby("run")
    return pd.DataFrame(
        {
            "label": g["label"].first(),
            "start": g["date"].first(),
            "end": g["date"].last(),
            "length": g.size(),
        }
    ).reset_index(drop=True)
