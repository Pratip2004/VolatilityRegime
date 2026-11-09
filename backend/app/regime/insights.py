"""User-facing regime insights built from the walk-forward history (HMM smoothed labels).

Pure functions on the history frame (indexed by date, with ``smoothed_label``, ``in_sample``,
``vix``, ``contango``, ``uvxy_close``, ``spx_close`` and optionally ``uvxy_next_ret``).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.regime.smoothing import spells


def _f(x) -> float | None:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if np.isfinite(v) else None


def next_day_returns(hist: pd.DataFrame) -> pd.Series:
    """Stored ``uvxy_next_ret`` (computed on the full panel calendar at training time), falling
    back to adjacent history rows."""
    if "uvxy_next_ret" in hist.columns:
        return hist["uvxy_next_ret"]
    return hist["uvxy_close"].shift(-1) / hist["uvxy_close"] - 1.0


def episodes(hist: pd.DataFrame, first_train_end: str) -> list[dict]:
    """Every regime spell with what markets did during it.

    ``uvxy_change`` / ``spx_change``: close on the last day before the spell → close on its last
    day (what happened over the spell, a historical outcome — not a forecast).
    """
    labels = hist["smoothed_label"]
    sp = spells(labels)
    idx = hist.index
    pos = {d: i for i, d in enumerate(idx)}
    cutoff = pd.Timestamp(first_train_end)
    last = idx.max()
    out = []
    for row in sp.itertuples(index=False):
        i0, i1 = pos[row.start], pos[row.end]
        seg = hist.iloc[i0 : i1 + 1]
        before = hist.iloc[i0 - 1] if i0 > 0 else None

        def change(col: str, seg=seg, before=before) -> float | None:
            if before is None:
                return None
            a, b = _f(before[col]), _f(seg[col].iloc[-1])
            return b / a - 1.0 if a and b is not None else None

        out.append(
            {
                "regime": row.label,
                "start": row.start.date().isoformat(),
                "end": row.end.date().isoformat(),
                "days": int(row.length),
                "ongoing": bool(row.end == last),
                "in_sample": bool(row.start <= cutoff),
                "previous_regime": None if before is None else str(before["smoothed_label"]),
                "next_regime": (
                    str(hist.iloc[i1 + 1]["smoothed_label"]) if i1 + 1 < len(hist) else None
                ),
                "vix_start": _f(seg["vix"].iloc[0]),
                "vix_peak": _f(seg["vix"].max()),
                "vix_end": _f(seg["vix"].iloc[-1]),
                "uvxy_change": change("uvxy_close"),
                "spx_change": change("spx_close") if "spx_close" in hist.columns else None,
            }
        )
    return out


def yearly_shares(hist: pd.DataFrame, names: list[str], first_train_end: str) -> list[dict]:
    cutoff_year = pd.Timestamp(first_train_end).year
    out = []
    for year, grp in hist.groupby(hist.index.year):
        lab = grp["smoothed_label"]
        out.append(
            {
                "year": int(year),
                "days": int(len(grp)),
                "in_sample": bool(year <= cutoff_year),
                "shares": {n: float((lab == n).mean()) for n in names},
            }
        )
    return out


def regime_profiles(
    hist: pd.DataFrame, names: list[str], eps: list[dict], risk: dict[str, dict]
) -> dict[str, dict]:
    """Per-regime summary on out-of-sample days (spell stats use out-of-sample spells)."""
    oos = hist[~hist["in_sample"].astype(bool)]
    oos_eps = [e for e in eps if not e["in_sample"] and not e["ongoing"]]
    out = {}
    for n in names:
        days = oos[oos["smoothed_label"] == n]
        lengths = np.array([e["days"] for e in oos_eps if e["regime"] == n])
        exits = [e["next_regime"] for e in oos_eps if e["regime"] == n and e["next_regime"]]
        out[n] = {
            "share_of_days": float(len(days) / len(oos)) if len(oos) else 0.0,
            "days": int(len(days)),
            "spells": int(len(lengths)),
            "spell_median": _f(np.median(lengths)) if len(lengths) else None,
            "spell_mean": _f(lengths.mean()) if len(lengths) else None,
            "spell_p75": _f(np.percentile(lengths, 75)) if len(lengths) else None,
            "spell_p90": _f(np.percentile(lengths, 90)) if len(lengths) else None,
            "spell_max": int(lengths.max()) if len(lengths) else None,
            "spell_lengths": [int(x) for x in sorted(lengths)],
            "exit_to": {
                m: (exits.count(m) / len(exits)) if exits else 0.0 for m in names if m != n
            },
            "vix_median": _f(days["vix"].median()) if len(days) else None,
            "vix_p10": _f(days["vix"].quantile(0.1)) if len(days) else None,
            "vix_p90": _f(days["vix"].quantile(0.9)) if len(days) else None,
            "contango_median": _f(days["contango"].median()) if len(days) else None,
            "risk": risk.get(n, {"count": 0}),
        }
    return out


def current_spell(hist: pd.DataFrame, eps: list[dict], profiles: dict[str, dict]) -> dict:
    """Today's spell and how its length compares with completed out-of-sample spells."""
    cur = eps[-1]
    lengths = np.array(profiles[cur["regime"]]["spell_lengths"])
    longer_than = float((lengths < cur["days"]).mean()) if len(lengths) else None
    still_running = (
        float((lengths > cur["days"]).sum() / max((lengths >= cur["days"]).sum(), 1))
        if len(lengths)
        else None
    )
    return cur | {
        "longer_than_share": longer_than,
        # Of past spells that reached today's length, the share that went on for at least
        # one more day — an empirical (not model) continuation rate.
        "continued_share": still_running,
    }


def build_insights(
    hist: pd.DataFrame, names: list[str], risk: dict[str, dict], first_train_end: str
) -> dict:
    eps = episodes(hist, first_train_end)
    profiles = regime_profiles(hist, names, eps, risk)
    oos = hist[~hist["in_sample"].astype(bool)]
    return {
        "names": names,
        "as_of": hist.index.max().date().isoformat(),
        "oos_start": oos.index.min().date().isoformat() if len(oos) else None,
        "profiles": profiles,
        "current": current_spell(hist, eps, profiles),
        "episodes": eps,
        "yearly": yearly_shares(hist, names, first_train_end),
    }
