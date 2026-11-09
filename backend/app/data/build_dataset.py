"""Build the aligned daily panel used by every analysis module.

Columns: ``date, vix, vix3m, vvix, vx1, vx2, spx_close, uvxy_close`` (UVXY split-adjusted).
The calendar is NYSE trading days: dates with both a VIX and an S&P 500 close (Cboe's VIX file
also carries rows on some market holidays since 2022; those are dropped). Other series are
aligned to it; isolated missing values are forward-filled by at most ``MAX_FFILL`` days (only
past values are used).
UVXY is NaN before its 2011-10-04 inception.

Run: ``python -m app.data.build_dataset [--refresh]``
"""

from __future__ import annotations

import argparse
import logging

import pandas as pd

from app.core.config import get_settings
from app.data import sources

log = logging.getLogger(__name__)

PANEL_COLUMNS = ["date", "vix", "vix3m", "vvix", "vx1", "vx2", "spx_close", "uvxy_close"]
MAX_FFILL = 3


def assemble_panel(series: dict[str, pd.Series], start: str) -> tuple[pd.DataFrame, dict]:
    """Align raw series on the VIX calendar. Pure function (no I/O) so it can be tested."""
    vix = series["vix"]
    cal = vix.index.intersection(series["spx_close"].index)
    cal = cal[cal >= pd.Timestamp(start)].sort_values()
    df = pd.DataFrame(index=cal)
    gaps: dict[str, int] = {}
    for col in PANEL_COLUMNS[1:]:
        s = series[col].sort_index()
        s = s[~s.index.duplicated(keep="last")]
        aligned = s.reindex(cal)
        first_valid = s.index.min()
        missing_after_start = aligned[cal >= first_valid].isna()
        gaps[col] = int(missing_after_start.sum())
        aligned = aligned.ffill(limit=MAX_FFILL)
        aligned[cal < first_valid] = float("nan")
        df[col] = aligned
    df.index.name = "date"
    df = df.reset_index()
    report = {
        "rows": len(df),
        "start": df["date"].min().date().isoformat(),
        "end": df["date"].max().date().isoformat(),
        "missing_before_ffill": gaps,
        "missing_after_ffill": {c: int(df[c].isna().sum()) for c in PANEL_COLUMNS[1:]},
    }
    return df[PANEL_COLUMNS], report


def fetch_all(refresh: bool = False) -> dict[str, pd.Series]:
    settings = get_settings()
    start = settings.data_start
    contracts = sources.fetch_vx_contracts(start, refresh)
    vx = sources.continuous_vx(contracts)
    return {
        "vix": sources.fetch_cboe_index("VIX", refresh),
        "vix3m": sources.fetch_vix3m(refresh),
        "vvix": sources.fetch_cboe_index("VVIX", refresh),
        "vx1": vx["vx1"],
        "vx2": vx["vx2"],
        "spx_close": sources.fetch_yahoo_close("^GSPC", start, refresh),
        "uvxy_close": sources.fetch_yahoo_close("UVXY", start, refresh),
    }


def build_panel(refresh: bool = False) -> tuple[pd.DataFrame, dict]:
    settings = get_settings()
    panel, report = assemble_panel(fetch_all(refresh), settings.data_start)
    settings.processed_dir.mkdir(parents=True, exist_ok=True)
    panel.to_parquet(settings.panel_path, index=False)
    log.info("panel written to %s (%d rows)", settings.panel_path, len(panel))
    return panel, report


def load_panel() -> pd.DataFrame:
    path = get_settings().panel_path
    if not path.exists():
        raise FileNotFoundError(f"{path} not found; run `python -m app.data.build_dataset` first")
    df = pd.read_parquet(path)
    df["date"] = pd.to_datetime(df["date"])
    return df


def main() -> None:
    import json

    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true", help="re-download live data")
    args = parser.parse_args()
    _, report = build_panel(refresh=args.refresh)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
