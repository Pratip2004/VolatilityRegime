"""Raw data downloads. Every fetch caches its raw file under ``data/raw`` and is re-used unless
``refresh=True``. Sources:

- VIX, VIX3M, VVIX: Cboe daily index history CSVs.
- VIX3M before 2009-09-18: FRED ``VXVCLS`` (same Cboe index, published from 2007-12-04).
- VX futures (monthly contracts): Cboe CFE historical data (archive files pre-2013, per-expiry
  files from 2013).
- S&P 500 close and UVXY adjusted close: Yahoo Finance via ``yfinance``.
"""

from __future__ import annotations

import io
import json
import logging
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import requests

from app.core.config import get_settings

log = logging.getLogger(__name__)

CBOE_INDEX_URL = "https://cdn.cboe.com/api/global/us_indices/daily_prices/{symbol}_History.csv"
FRED_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={series}"
VX_LIST_URL = "https://www.cboe.com/us/futures/market_statistics/historical_data/product/list/VX/"
VX_NEW_URL = "https://cdn.cboe.com/{path}"
VX_ARCHIVE_URL = (
    "https://cdn.cboe.com/resources/futures/archive/volume-and-price/CFE_{code}{yy:02d}_VX.csv"
)
MONTH_CODES = "FGHJKMNQUVXZ"
# Contracts expiring before VX_LISTING_START exist only in the archive. Per-expiry files of the
# 2013 contracts start on 2013-01-02, so archive files are also read up to VX_ARCHIVE_END to cover
# their late-2012 history; where both exist the per-expiry file wins.
VX_LISTING_START = date(2013, 1, 1)
VX_ARCHIVE_END = date(2014, 1, 1)
# Before this date VX traded on the 10x-scaled "VBI" convention.
VX_RESCALE_DATE = pd.Timestamp("2007-03-26")


def _get(url: str) -> bytes:
    resp = requests.get(url, timeout=get_settings().http_timeout)
    resp.raise_for_status()
    return resp.content


def _cached(name: str, url: str, refresh: bool) -> bytes:
    raw_dir = get_settings().raw_dir
    raw_dir.mkdir(parents=True, exist_ok=True)
    path = raw_dir / name
    if path.exists() and not refresh:
        return path.read_bytes()
    content = _get(url)
    path.write_bytes(content)
    return content


def fetch_cboe_index(symbol: str, refresh: bool = False) -> pd.Series:
    """Daily close of a Cboe index (VIX, VIX3M, VVIX)."""
    content = _cached(f"cboe_{symbol}.csv", CBOE_INDEX_URL.format(symbol=symbol), refresh)
    df = pd.read_csv(io.BytesIO(content))
    df.columns = [c.strip().upper() for c in df.columns]
    col = "CLOSE" if "CLOSE" in df.columns else symbol.upper()
    s = pd.Series(
        pd.to_numeric(df[col], errors="coerce").to_numpy(),
        index=pd.to_datetime(df["DATE"], format="%m/%d/%Y"),
        name=symbol.lower(),
    )
    return s[s > 0].dropna().sort_index()


def fetch_fred(series: str, refresh: bool = False) -> pd.Series:
    content = _cached(f"fred_{series}.csv", FRED_URL.format(series=series), refresh)
    df = pd.read_csv(io.BytesIO(content), na_values=["."])
    s = pd.Series(
        pd.to_numeric(df[series], errors="coerce").to_numpy(),
        index=pd.to_datetime(df.iloc[:, 0]),
        name=series,
    )
    return s.dropna().sort_index()


def fetch_vix3m(refresh: bool = False) -> pd.Series:
    """VIX3M from Cboe, back-filled with FRED VXVCLS before Cboe's file starts."""
    cboe = fetch_cboe_index("VIX3M", refresh)
    fred = fetch_fred("VXVCLS", refresh)
    early = fred[fred.index < cboe.index.min()]
    return pd.concat([early, cboe]).rename("vix3m").sort_index()


def fetch_yahoo_close(ticker: str, start: str, refresh: bool = False) -> pd.Series:
    """Split/dividend-adjusted daily close from Yahoo Finance."""
    import yfinance as yf

    raw_dir = get_settings().raw_dir
    raw_dir.mkdir(parents=True, exist_ok=True)
    path = raw_dir / f"yahoo_{ticker.replace('^', '')}.csv"
    if path.exists() and not refresh:
        df = pd.read_csv(path, index_col=0, parse_dates=True)
        return df.iloc[:, 0].rename(ticker)
    data = yf.download(ticker, start=start, auto_adjust=True, progress=False, threads=False)
    if data is None or data.empty:
        raise RuntimeError(f"Yahoo returned no data for {ticker}")
    close = data["Close"]
    if isinstance(close, pd.DataFrame):
        close = close.iloc[:, 0]
    close = close.dropna().rename(ticker)
    close.index = pd.to_datetime(close.index).tz_localize(None).normalize()
    close.to_frame().to_csv(path)
    return close


# ---------------------------------------------------------------------------------------------
# VX futures
# ---------------------------------------------------------------------------------------------


def vx_expiry(year: int, month: int) -> date:
    """Standard VX expiry: the Wednesday 30 days before the third Friday of the following month.

    Exchange-holiday adjustments are not applied; only used to place archive contracts (2007-2012)
    where none occurred for monthly contracts.
    """
    ny, nm = (year + 1, 1) if month == 12 else (year, month + 1)
    first = date(ny, nm, 1)
    third_friday = first + timedelta(days=(4 - first.weekday()) % 7 + 14)
    return third_friday - timedelta(days=30)


def _parse_vx_file(content: bytes, expiry: date) -> pd.DataFrame:
    lines = content.decode("utf-8", errors="ignore").splitlines()
    # Some archive files start with a disclaimer line, or a stray prefix ("cTrade Date").
    header = next((i for i, line in enumerate(lines) if "Trade Date" in line), None)
    if header is None:
        raise ValueError("no 'Trade Date' header in VX file")
    df = pd.read_csv(io.StringIO("\n".join(lines[header:])))
    df.columns = ["date" if "Trade Date" in c else c.strip() for c in df.columns]
    df = df[df["date"].astype(str).str.match(r"^\d")]
    df["date"] = pd.to_datetime(df["date"], format="mixed")
    settle = pd.to_numeric(df.get("Settle"), errors="coerce")
    close = pd.to_numeric(df.get("Close"), errors="coerce")
    # Settle is the official end-of-day price; some 2013 files report 0, fall back to Close.
    price = settle.where(settle > 0, close.where(close > 0))
    price = price.where(df["date"] >= VX_RESCALE_DATE, price / 10.0)
    out = pd.DataFrame({"date": df["date"], "price": price, "expiry": pd.Timestamp(expiry)})
    return out.dropna(subset=["price"])


def _vx_listing(refresh: bool) -> list[dict]:
    content = _cached("cboe_vx_listing.json", VX_LIST_URL, refresh)
    listing = json.loads(content)
    items = [x for year in listing.values() for x in year if x.get("duration_type") == "M"]
    return sorted(items, key=lambda x: x["expire_date"])


def fetch_vx_contracts(start: str, refresh: bool = False) -> pd.DataFrame:
    """All monthly VX contract settlements expiring on/after ``start``.

    Returns long frame ``date, price, expiry``. Already-expired contracts are cached forever;
    only live contracts are re-downloaded on ``refresh``.
    """
    start_d = pd.Timestamp(start).date()
    today = date.today()
    frames: list[pd.DataFrame] = []

    # Archive contracts.
    y, m = start_d.year, start_d.month
    while date(y, m, 1) < VX_ARCHIVE_END:
        exp = vx_expiry(y, m)
        name = f"cboe_vx_{y}{m:02d}.csv"
        url = VX_ARCHIVE_URL.format(code=MONTH_CODES[m - 1], yy=y % 100)
        try:
            frames.append(_parse_vx_file(_cached(name, url, refresh=False), exp))
        except requests.HTTPError as exc:  # pragma: no cover - network
            if date(y, m, 1) < VX_LISTING_START:
                log.warning("missing VX archive file %s: %s", url, exc)
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)

    # Contracts from the product listing (2013 onward).
    for item in _vx_listing(refresh):
        exp = date.fromisoformat(item["expire_date"])
        if exp < start_d:
            continue
        name = f"cboe_vx_{exp.isoformat()}.csv"
        live = exp >= today
        try:
            content = _cached(name, VX_NEW_URL.format(path=item["path"]), refresh and live)
        except requests.HTTPError as exc:  # pragma: no cover - network
            log.warning("missing VX file %s: %s", item["path"], exc)
            continue
        frames.append(_parse_vx_file(content, exp))

    return pd.concat(frames, ignore_index=True)


def continuous_vx(contracts: pd.DataFrame) -> pd.DataFrame:
    """Unadjusted front (vx1) and second (vx2) month settlements per trade date.

    On date ``t`` the front month is the contract with the earliest expiry strictly after ``t``
    (VX stops trading the day before its expiry), so no data after ``t`` is used.
    """
    df = contracts[contracts["date"] < contracts["expiry"]]
    df = df.sort_values(["date", "expiry"])
    df = df.drop_duplicates(["date", "expiry"], keep="last")
    df["rank"] = df.groupby("date").cumcount()
    wide = df[df["rank"] < 2].pivot(index="date", columns="rank", values="price")
    wide = wide.rename(columns={0: "vx1", 1: "vx2"})
    wide.columns.name = None
    return wide[["vx1", "vx2"]]


def raw_path(name: str) -> Path:
    return get_settings().raw_dir / name
