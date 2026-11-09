# UVXY risk project

Tools for understanding UVXY / VIX-futures risk: a Python (FastAPI) backend with a shared daily data
layer and analysis modules, and a React + Vite + TypeScript + Ant Design v5 frontend.

## Stack

- **Backend** (`backend/`): Python 3.11, FastAPI, Pydantic v2, pandas, numpy, scipy,
  scikit-learn, hmmlearn. Managed with `uv` (`uv sync`, `uv run pytest`, `uv run ruff check .`).
- **Frontend** (`client/`): React 18, Vite, TypeScript (strict), Ant Design v5, Tailwind CSS,
  TanStack Query, React Router, Recharts. `npm run dev`, `npm run build`, `npm test`.

## Repository layout

```
backend/
  app/
    core/config.py          settings + all tunable parameters
    data/sources.py         raw downloads (cached in data/raw/)
    data/build_dataset.py   aligned daily panel -> data/processed/panel.parquet
    montecarlo/             spot-VIX process calibration
    regime/                 volatility regime detector (see below)
    api/routes/             FastAPI routers (mounted under /api)
    main.py                 FastAPI app
  tests/
  data/                     raw + processed data (git-ignored)
client/
  src/
    api/                    fetch client + TanStack Query hooks
    components/             shared UI pieces
    layouts/AppLayout.tsx   Sider menu + content
    pages/                  one file per page
    types/                  TS mirrors of the API models
docs/
```

## Data sources

| Column | Source |
|---|---|
| `vix`, `vvix` | Cboe daily index history CSVs (`cdn.cboe.com/api/global/us_indices/daily_prices/`) |
| `vix3m` | Cboe VIX3M history; before 2009-09-18 FRED `VXVCLS` (from 2007-12-04) |
| `vx1`, `vx2` | Cboe CFE monthly VX settlements (archive files pre-2013, per-expiry files after); unadjusted front/second month, rolled the day before expiry |
| `spx_close` | Yahoo Finance `^GSPC` via `yfinance` |
| `uvxy_close` | Yahoo Finance `UVXY`, split-adjusted, via `yfinance` |

Build or refresh the panel: `cd backend && uv run python -m app.data.build_dataset [--refresh]`.

## Conventions

- Backend: every tunable number lives in `core/config.py`. Pure functions where possible, I/O at the
  edges. No look-ahead: any value shown for day `t` uses data up to and including `t` only.
- API: Pydantic v2 response models; mirror each one in `client/src/types/`.
- Frontend: AntD v5 components + Tailwind for layout; `Typography` for text; one file per page;
  every page handles loading, empty and error states. Data via typed TanStack Query hooks.
- Nothing in the UI gives trading recommendations; show the "not investment advice" note.
- Tests: `backend/tests/` (pytest, no network — use fixtures); ruff clean.

## Regime detector

Spec: [`docs/REGIME_DETECTOR.md`](docs/REGIME_DETECTOR.md). Labels each day Calm / Stressed / Panic
from a 3-state Gaussian HMM on term-structure and volatility features, using filtered
(no-look-ahead) probabilities, walk-forward training and hysteresis smoothing.

- Backend: `backend/app/regime/` (`features.py`, `hmm_model.py`, `smoothing.py`, `baseline.py`,
  `walk_forward.py`, `risk_stats.py`, `validation.py`, `service.py`), routes in
  `backend/app/api/routes/regime.py` under `/api/regime`, tests in `backend/tests/regime/`.
- Frontend pages: `client/src/pages/RegimeTodayPage.tsx`, `client/src/pages/RegimeHistoryPage.tsx`,
  `client/src/pages/RegimeDiagnosticsPage.tsx` (Sider menu group "Regime").
