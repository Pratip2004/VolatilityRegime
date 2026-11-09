from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd
import pytest

from app.core.config import ALL_FEATURES, RegimeConfig
from app.data import sources
from app.data.build_dataset import PANEL_COLUMNS, assemble_panel
from app.regime.features import build_features, compute_all_features, rolling_percentile_rank


# ---------------------------------------------------------------------------- data layer
@pytest.mark.parametrize(
    ("year", "month", "expected"),
    [
        (2008, 1, date(2008, 1, 16)),
        (2013, 1, date(2013, 1, 16)),
        (2013, 2, date(2013, 2, 13)),
        (2012, 12, date(2012, 12, 19)),
    ],
)
def test_vx_expiry_rule(year: int, month: int, expected: date) -> None:
    assert sources.vx_expiry(year, month) == expected


def test_parse_vx_file_handles_disclaimer_zero_settle_and_rescale() -> None:
    content = (
        b"CFE data is compiled for convenience\n"
        b"Trade Date,Futures,Open,High,Low,Close,Settle,Change,Total Volume,EFP,Open Interest\n"
        b"03/23/2007,F (Jan 08),0,0,0,0,150.0,0,0,0,0\n"
        b"01/02/2008,F (Jan 08),0,0,0,22.5,0,0,0,0,0\n"
        b"01/03/2008,F (Jan 08),0,0,0,0,23.1,0,0,0,0\n"
        b"01/04/2008,F (Jan 08),0,0,0,0,0,0,0,0,0\n"
    )
    df = sources._parse_vx_file(content, date(2008, 1, 16))
    assert list(df["price"]) == [15.0, 22.5, 23.1]  # 10x rescale, close fallback, zero dropped
    assert (df["expiry"] == pd.Timestamp("2008-01-16")).all()


def test_continuous_vx_picks_front_and_second_strictly_before_expiry() -> None:
    rows = []
    for d in ["2020-01-14", "2020-01-15", "2020-01-16"]:
        rows.append((d, 15.0, "2020-01-15"))
        rows.append((d, 16.0, "2020-02-19"))
        rows.append((d, 17.0, "2020-03-18"))
    contracts = pd.DataFrame(rows, columns=["date", "price", "expiry"])
    contracts["date"] = pd.to_datetime(contracts["date"])
    contracts["expiry"] = pd.to_datetime(contracts["expiry"])
    vx = sources.continuous_vx(contracts)
    assert vx.loc["2020-01-14"].tolist() == [15.0, 16.0]
    # On the expiry day the expiring contract no longer counts.
    assert vx.loc["2020-01-15"].tolist() == [16.0, 17.0]
    assert vx.loc["2020-01-16"].tolist() == [16.0, 17.0]


def test_assemble_panel_calendar_and_ffill() -> None:
    days = pd.bdate_range("2020-01-01", periods=10)
    vix = pd.Series(np.arange(10.0) + 10, index=days)
    holiday = days[3]
    spx = pd.Series(100.0, index=days.drop(holiday))
    other = pd.Series(1.0, index=days.drop(days[5]))
    late = pd.Series(5.0, index=days[6:])
    series = {
        "vix": vix,
        "vix3m": other,
        "vvix": other,
        "vx1": other,
        "vx2": other,
        "spx_close": spx,
        "uvxy_close": late,
    }
    panel, report = assemble_panel(series, "2020-01-01")
    assert list(panel.columns) == PANEL_COLUMNS
    assert holiday not in set(panel["date"])  # VIX-only day (no SPX) dropped
    assert report["rows"] == 9
    assert report["missing_before_ffill"]["vix3m"] == 1
    assert panel["vix3m"].notna().all()  # gap forward-filled
    assert panel.loc[panel["date"] < days[6], "uvxy_close"].isna().all()  # no back-fill


# ---------------------------------------------------------------------------- features
def test_rolling_percentile_rank() -> None:
    s = pd.Series([1.0, 2.0, 3.0, 2.0, 0.5])
    r = rolling_percentile_rank(s, 3)
    assert np.isnan(r.iloc[0]) and np.isnan(r.iloc[1])
    assert r.iloc[2] == pytest.approx(1.0)
    assert r.iloc[3] == pytest.approx(2 / 3)
    assert r.iloc[4] == pytest.approx(1 / 3)


def test_feature_formulas(panel: pd.DataFrame) -> None:
    f = compute_all_features(panel)
    p = panel.set_index("date")
    np.testing.assert_allclose(f["contango"], p["vx2"] / p["vx1"] - 1)
    np.testing.assert_allclose(f["vix_ratio"], p["vix"] / p["vix3m"])
    np.testing.assert_allclose(f["log_vvix"], np.log(p["vvix"]))
    t = 100
    rets = np.diff(np.log(p["spx_close"].to_numpy()[t - 20 : t + 1]))
    assert f["rv20"].iloc[t] == pytest.approx(rets.std(ddof=1) * np.sqrt(252))
    assert f["d_contango_5"].iloc[t] == pytest.approx(
        f["contango"].iloc[t] - f["contango"].iloc[t - 5]
    )


def test_features_have_no_look_ahead(panel: pd.DataFrame) -> None:
    full = compute_all_features(panel)
    cut = 900
    trunc = compute_all_features(panel.iloc[:cut])
    pd.testing.assert_frame_equal(full.iloc[:cut], trunc)


def test_build_features_drops_warmup_and_respects_start(panel: pd.DataFrame) -> None:
    cfg = RegimeConfig(analysis_start="2008-01-01")
    f = build_features(panel, cfg)
    assert f.index.min() >= pd.Timestamp("2008-01-01")
    assert not f[list(ALL_FEATURES)].isna().any().any()
    # 252-day warm-up comes from pre-2008 history, so features start right at analysis_start.
    assert (f.index.min() - pd.Timestamp("2008-01-01")).days < 5


def test_feature_subset_config(panel: pd.DataFrame) -> None:
    cfg = RegimeConfig(features=["contango", "vix_ratio"])
    f = build_features(panel, cfg)
    assert "rv20" not in f.columns and "contango" in f.columns


def test_config_rejects_bad_values() -> None:
    with pytest.raises(ValueError):
        RegimeConfig(n_states=5)
    with pytest.raises(ValueError):
        RegimeConfig(features=["vix_ratio"])


def test_vx_expiry_good_friday_2008() -> None:
    # Third Friday of March 2008 was Good Friday, so Feb-2008 VX expired Tuesday 2008-02-19.
    assert sources.good_friday(2008) == date(2008, 3, 21)
    assert sources.vx_expiry(2008, 2) == date(2008, 2, 19)


def test_vx_stale_cache_detection(tmp_path, monkeypatch) -> None:
    import os

    from app.core.config import Settings

    monkeypatch.setattr(sources, "get_settings", lambda: Settings(data_dir=tmp_path))
    raw = tmp_path / "raw"
    raw.mkdir()
    f = raw / "cboe_vx_2026-11-18.csv"
    assert sources._vx_stale(f.name, date(2026, 11, 18))  # missing → stale
    f.write_text("x")
    ts = pd.Timestamp("2026-11-06").timestamp()
    os.utime(f, (ts, ts))
    assert sources._vx_stale(f.name, date(2026, 11, 18))  # cached before expiry
    ts = pd.Timestamp("2026-11-20").timestamp()
    os.utime(f, (ts, ts))
    assert not sources._vx_stale(f.name, date(2026, 11, 18))  # cached after expiry: final


def test_continuous_vx_later_frame_wins_on_overlap() -> None:
    a = pd.DataFrame(
        {
            "date": pd.to_datetime(["2013-01-02"]),
            "price": [16.75],
            "expiry": pd.to_datetime(["2013-01-16"]),
        }
    )
    b = a.assign(price=[16.72])
    c = a.assign(price=[18.0], expiry=pd.to_datetime(["2013-02-13"]))
    vx = sources.continuous_vx(pd.concat([a, c, b], ignore_index=True))
    assert vx.loc["2013-01-02", "vx1"] == 16.72


def test_assemble_panel_ffill_limit() -> None:
    from app.data.build_dataset import MAX_FFILL

    days = pd.bdate_range("2020-01-01", periods=12)
    full = pd.Series(1.0, index=days)
    holey = pd.Series(1.0, index=days[:2].append(days[2 + MAX_FFILL + 1 :]))
    series = {c: full for c in ["vix", "vix3m", "vvix", "vx1", "vx2", "spx_close", "uvxy_close"]}
    series["vvix"] = holey
    panel, _ = assemble_panel(series, "2020-01-01")
    assert panel["vvix"].isna().sum() == 1
