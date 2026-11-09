"""Validation checks. Every check runs on the HMM smoothed labels and the baseline labels."""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.core.config import RegimeConfig
from app.regime.risk_stats import risk_stats_by_regime
from app.regime.smoothing import flips_per_year, spells

KNOWN_EPISODES: list[tuple[str, str, str]] = [
    ("Financial crisis", "2008-09-15", "2008-12-31"),
    ("Flash crash", "2010-05-06", "2010-06-30"),
    ("US downgrade / euro crisis", "2011-08-01", "2011-10-31"),
    ("China devaluation", "2015-08-20", "2015-09-30"),
    ("Volmageddon", "2018-02-02", "2018-02-28"),
    ("COVID", "2020-02-24", "2020-04-30"),
    ("Carry-trade unwind", "2024-08-01", "2024-08-09"),
]
ELEVATED = ("Stressed", "Panic")
DURATION_BINS = [1, 2, 3, 6, 11, 21, 41, 81, 161, 10_000]


def _flag(labels: pd.Series) -> pd.Series:
    return labels.isin(ELEVATED)


def known_episodes(
    labels: dict[str, pd.Series], first_train_end: str, pass_share: float
) -> list[dict]:
    """Share of days flagged Stressed/Panic per episode for each label source."""
    cutoff = pd.Timestamp(first_train_end)
    rows = []
    for name, start, end in KNOWN_EPISODES:
        s, e = pd.Timestamp(start), pd.Timestamp(end)
        row: dict = {"name": name, "start": start, "end": end, "in_sample": bool(s <= cutoff)}
        for src, lab in labels.items():
            win = lab[(lab.index >= s) & (lab.index <= e)]
            share = float(_flag(win).mean()) if len(win) else None
            row[src] = {
                "days": int(len(win)),
                "share_flagged": share,
                "share_panic": float((win == "Panic").mean()) if len(win) else None,
                "passed": bool(share is not None and share >= pass_share),
            }
        rows.append(row)
    return rows


def share_calm_in_year(labels: pd.Series, year: int) -> float | None:
    win = labels[labels.index.year == year]
    return float((win == "Calm").mean()) if len(win) else None


def duration_stats(labels: pd.Series, names: list[str]) -> dict[str, dict]:
    sp = spells(labels)
    out = {}
    for n in names:
        lengths = sp.loc[sp["label"] == n, "length"].to_numpy()
        if len(lengths) == 0:
            out[n] = {"spells": 0}
            continue
        hist, _ = np.histogram(lengths, bins=DURATION_BINS)
        out[n] = {
            "spells": int(len(lengths)),
            "mean": float(lengths.mean()),
            "median": float(np.median(lengths)),
            "max": int(lengths.max()),
            "share_le_10d": float((lengths <= 10).mean()),
            "histogram": {
                "bins": [
                    f"{lo}-{hi - 1}" if hi - lo > 1 else f"{lo}"
                    for lo, hi in zip(DURATION_BINS[:-1], DURATION_BINS[1:], strict=True)
                ][:-1]
                + [f"{DURATION_BINS[-2]}+"],
                "counts": [int(c) for c in hist],
            },
        }
    return out


def spike_days(vix: pd.Series, threshold: float, window: int) -> pd.Series:
    """True at ``t`` if VIX rises >= threshold above its close at ``t`` within the next
    ``window`` days. Uses future data by construction: an evaluation target, never a feature.
    NaN where the full forward window is not available."""
    fwd = pd.concat([vix.shift(-k) for k in range(1, window + 1)], axis=1).max(axis=1)
    full = vix.shift(-window).notna()
    out = (fwd / vix - 1.0 >= threshold).astype(float)
    return out.where(full)


def spike_lead_time(labels: pd.Series, spikes: pd.Series) -> dict:
    df = pd.DataFrame({"flag": _flag(labels), "spike": spikes}).dropna()
    spike = df["spike"].astype(bool)
    flag = df["flag"].astype(bool)
    n_spike = int(spike.sum())
    # Distinct spike events: first day of each run of consecutive spike days.
    starts = spike & ~spike.shift(1, fill_value=False)
    leads = []
    for t in df.index[starts.to_numpy()]:
        before = flag.loc[:t].to_numpy()[::-1]
        run = 0
        for f in before:
            if not f:
                break
            run += 1
        leads.append(run)
    return {
        "spike_days": n_spike,
        "spike_events": int(starts.sum()),
        "hit_rate": float(flag[spike].mean()) if n_spike else None,
        "event_hit_rate": float(np.mean([x > 0 for x in leads])) if leads else None,
        "false_alarm_rate": float(flag[~spike].mean()) if (~spike).any() else None,
        "precision": float(spike[flag].mean()) if flag.any() else None,
        "median_days_flagged_before_event": float(np.median(leads)) if leads else None,
    }


def run_validation(
    hist: pd.DataFrame,
    names: list[str],
    cfg: RegimeConfig,
    uvxy_close: pd.Series | None = None,
) -> dict:
    """``hist`` = walk-forward history (needs smoothed_label, raw_label, baseline_label,
    in_sample, vix, uvxy_close). ``uvxy_close`` on the full trading calendar is preferred for
    next-day returns; defaults to ``hist["uvxy_close"]``."""
    close = hist["uvxy_close"] if uvxy_close is None else uvxy_close
    vcfg = cfg.validation
    sources = {"hmm": hist["smoothed_label"], "baseline": hist["baseline_label"]}
    oos = hist[~hist["in_sample"].astype(bool)]
    oos_sources = {"hmm": oos["smoothed_label"], "baseline": oos["baseline_label"]}

    spikes = spike_days(hist["vix"], vcfg.spike_threshold, vcfg.spike_window).loc[oos.index]
    result: dict = {
        "oos_start": oos.index.min().date().isoformat() if len(oos) else None,
        "oos_end": oos.index.max().date().isoformat() if len(oos) else None,
        "oos_days": int(len(oos)),
        "known_episodes": known_episodes(sources, cfg.first_train_end, vcfg.pass_share),
        "calm_share_year": {
            "year": vcfg.calm_year,
            **{k: share_calm_in_year(v, vcfg.calm_year) for k, v in oos_sources.items()},
        },
        "economic_separation": {
            k: risk_stats_by_regime(v, close, names) for k, v in oos_sources.items()
        },
        "durations": {k: duration_stats(v, names) for k, v in oos_sources.items()},
        "stability": {
            "hmm_raw_flips_per_year": flips_per_year(oos["raw_label"]),
            "hmm_smoothed_flips_per_year": flips_per_year(oos["smoothed_label"]),
            "baseline_flips_per_year": flips_per_year(oos["baseline_label"]),
        },
        "spike_lead_time": {
            "threshold": vcfg.spike_threshold,
            "window": vcfg.spike_window,
            **{k: spike_lead_time(v, spikes) for k, v in oos_sources.items()},
        },
        "label_share": {
            k: {n: float((v == n).mean()) if len(v) else 0.0 for n in names}
            for k, v in oos_sources.items()
        },
    }
    result["summary"] = summarize(result)
    return result


TIE_RELATIVE_TOLERANCE = 0.10


def compare(
    hmm: float | None,
    base: float | None,
    higher_is_better: bool,
    must_be_positive: bool = False,
    tol: float = TIE_RELATIVE_TOLERANCE,
) -> str | None:
    """``hmm`` / ``baseline`` / ``tie`` / ``neither`` (both fail a required sign) / None.

    Differences within ``tol`` of the larger magnitude count as a tie, so noise-level gaps
    are not reported as wins.
    """
    if hmm is None or base is None:
        return None
    if must_be_positive and hmm <= 0 and base <= 0:
        return "neither"
    if abs(hmm - base) <= tol * max(abs(hmm), abs(base), 1e-12):
        return "tie"
    return "hmm" if (hmm > base) == higher_is_better else "baseline"


def summarize(r: dict) -> list[dict]:
    """HMM vs baseline on each check: ``{check, hmm, baseline, better}``."""
    rows = []

    def add(check: str, hmm, base, higher_is_better: bool, must_be_positive: bool = False) -> None:
        better = compare(hmm, base, higher_is_better, must_be_positive)
        rows.append({"check": check, "hmm": hmm, "baseline": base, "better": better})

    oos_eps = [e for e in r["known_episodes"] if not e["in_sample"]]
    ins_eps = [e for e in r["known_episodes"] if e["in_sample"]]
    for label, eps in (
        ("OOS episodes: mean share flagged", oos_eps),
        ("In-sample episodes: mean share flagged", ins_eps),
    ):
        vals = {
            s: [e[s]["share_flagged"] for e in eps if e[s]["share_flagged"] is not None]
            for s in ("hmm", "baseline")
        }
        add(
            label,
            *(float(np.mean(vals[s])) if vals[s] else None for s in ("hmm", "baseline")),
            True,
        )
    cy = r["calm_share_year"]
    add(f"Share of {cy['year']} labelled Calm", cy["hmm"], cy["baseline"], True)
    es = r["economic_separation"]

    def spread(src: str) -> float | None:
        c, p = es[src].get("Calm", {}), es[src].get("Panic", {})
        if c.get("count") and p.get("count"):
            return p["std"] / c["std"]
        return None

    def calm_mean(src: str) -> float | None:
        c = es[src].get("Calm", {})
        return c.get("mean") if c.get("count") else None

    add("Panic/Calm next-day std ratio", spread("hmm"), spread("baseline"), True)
    add("Calm next-day mean return", calm_mean("hmm"), calm_mean("baseline"), False)

    def panic_minus_calm(src: str) -> float | None:
        c, p = es[src].get("Calm", {}), es[src].get("Panic", {})
        return p["mean"] - c["mean"] if c.get("count") and p.get("count") else None

    add(
        "Panic minus Calm next-day mean (expected > 0)",
        panic_minus_calm("hmm"),
        panic_minus_calm("baseline"),
        True,
        must_be_positive=True,
    )
    st = r["stability"]
    add(
        "Flips per year (smoothed)",
        st["hmm_smoothed_flips_per_year"],
        st["baseline_flips_per_year"],
        False,
    )
    sl = r["spike_lead_time"]
    add("Spike hit rate (days)", sl["hmm"]["hit_rate"], sl["baseline"]["hit_rate"], True)
    add(
        "Spike hit rate (events)",
        sl["hmm"]["event_hit_rate"],
        sl["baseline"]["event_hit_rate"],
        True,
    )
    add("Spike precision", sl["hmm"]["precision"], sl["baseline"]["precision"], True)
    add(
        "Spike false-alarm rate",
        sl["hmm"]["false_alarm_rate"],
        sl["baseline"]["false_alarm_rate"],
        False,
    )
    return rows
