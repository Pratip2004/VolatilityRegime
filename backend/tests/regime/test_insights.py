from __future__ import annotations

import pandas as pd
import pytest

from app.regime.insights import build_insights, episodes, yearly_shares

NAMES = ["Calm", "Stressed", "Panic"]


def _hist() -> pd.DataFrame:
    idx = pd.bdate_range("2013-12-26", periods=12)
    labels = ["Calm"] * 4 + ["Panic"] * 3 + ["Calm"] * 2 + ["Stressed"] * 3
    return pd.DataFrame(
        {
            "smoothed_label": labels,
            "in_sample": [d <= pd.Timestamp("2013-12-31") for d in idx],
            "vix": [12, 12, 13, 14, 30, 40, 35, 20, 15, 18, 19, 20.0],
            "contango": [0.08] * 4 + [-0.05] * 3 + [0.06] * 2 + [0.02] * 3,
            "uvxy_close": [100, 100, 100, 100, 150, 200, 180, 120, 110, 115, 118, 120.0],
            "spx_close": [2000.0] * 4 + [1900.0] * 3 + [1950.0] * 5,
        },
        index=idx,
    )


def test_episodes_cover_every_day_with_outcomes() -> None:
    h = _hist()
    eps = episodes(h, "2013-12-31")
    assert [e["regime"] for e in eps] == ["Calm", "Panic", "Calm", "Stressed"]
    assert sum(e["days"] for e in eps) == len(h)
    panic = eps[1]
    assert panic["previous_regime"] == "Calm" and panic["next_regime"] == "Calm"
    assert panic["vix_peak"] == 40 and panic["vix_start"] == 30
    assert panic["uvxy_change"] == pytest.approx(180 / 100 - 1)  # close before → last day
    assert panic["spx_change"] == pytest.approx(1900 / 2000 - 1)
    assert eps[0]["uvxy_change"] is None  # no close before the first spell
    assert eps[0]["in_sample"] and not panic["in_sample"]
    assert eps[-1]["ongoing"] and not panic["ongoing"]


def test_yearly_shares() -> None:
    y = yearly_shares(_hist(), NAMES, "2013-12-31")
    assert [r["year"] for r in y] == [2013, 2014]
    assert y[0]["in_sample"] and not y[1]["in_sample"]
    for r in y:
        assert sum(r["shares"].values()) == pytest.approx(1.0)


def test_build_insights_profiles_and_current_spell() -> None:
    risk = {n: {"count": 0} for n in NAMES}
    ins = build_insights(_hist(), NAMES, risk, "2013-12-31")
    assert ins["as_of"] == _hist().index.max().date().isoformat()
    p = ins["profiles"]
    oos_days = 8  # 2014-01-01 onward
    assert sum(p[n]["days"] for n in NAMES) == oos_days
    # Completed OOS spells only: Panic (3), Calm (2); Stressed is ongoing.
    assert p["Panic"]["spell_lengths"] == [3]
    assert p["Panic"]["exit_to"] == {"Calm": 1.0, "Stressed": 0.0}
    assert p["Stressed"]["spells"] == 0
    cur = ins["current"]
    assert cur["regime"] == "Stressed" and cur["days"] == 3 and cur["ongoing"]
    assert cur["longer_than_share"] is None  # no completed Stressed spells to compare


def test_continued_share_is_none_when_spell_is_longer_than_all_past_spells() -> None:
    h = _hist()
    # Make the final Stressed spell 3 days and give Stressed a completed 2-day spell earlier.
    h.iloc[4:7, h.columns.get_loc("smoothed_label")] = ["Stressed", "Stressed", "Panic"]
    ins = build_insights(h, NAMES, {n: {"count": 0} for n in NAMES}, "2013-12-31")
    assert ins["current"]["regime"] == "Stressed" and ins["current"]["days"] == 3
    assert ins["profiles"]["Stressed"]["spell_lengths"] == [2]
    assert ins["current"]["continued_share"] is None
    assert ins["current"]["longer_than_share"] == 1.0
