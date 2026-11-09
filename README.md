# UVXY risk: volatility regime detector

Labels every trading day **Calm**, **Stressed** or **Panic**, with a probability for each, using
only data available at that day's close. It then shows how large next-day UVXY moves have been in
each regime. It describes **how risky tomorrow is likely to be**: the typical range and the size
of the tails.

> It describes the **size** of likely moves, **not their direction**. It does not forecast UVXY,
> place trades or give recommendations. Not investment advice.

Full spec: [`docs/REGIME_DETECTOR.md`](docs/REGIME_DETECTOR.md). Project conventions:
[`CLAUDE.md`](CLAUDE.md).

---

## How it works, in plain English

1. **Six daily measurements of market stress**, each computed from data up to that day only:
   - **Contango:** the slope of the VIX futures curve (VX2/VX1 − 1). Negative means backwardation,
     which is a classic panic sign.
   - **VIX / VIX3M:** near-term fear versus 3-month fear.
   - **VVIX:** how volatile VIX itself is.
   - **20-day realized S&P 500 volatility.**
   - **VIX percentile:** where VIX sits within its last year.
   - **5-day change in contango.**
2. **A hidden Markov model (HMM)** assumes the market switches between three hidden "moods". Each
   mood has its own typical mix of those measurements, and moods tend to persist from day to day.
   The model learns the moods and how often one turns into another.
3. **Naming:** the mood with the steepest contango is called *Calm*, the flattest or inverted one
   is *Panic*, and the one in between is *Stressed*.
4. **No hindsight:** today's probabilities come from a forward pass that only looks backwards in
   time ("filtered" probabilities). The smoothed, hindsight version exists only on the Diagnostics
   page, clearly labelled.
5. **Walk-forward training:** the model is first trained on 2008–2013. It then labels 2014, is
   retrained on 2008–2014, labels 2015, and so on. Every label from 2014 onward is genuinely
   out-of-sample.
6. **Hysteresis:** to avoid flip-flopping, the label only switches to Calm or Stressed when that
   probability reaches 60%. It enters Panic at 70% and leaves Panic only below 40%.
7. **Next-day risk:** for each regime, it records the distribution of the *next* day's UVXY return
   (close to close), using out-of-sample days only.

A simple rule-based **baseline** is reported alongside every check for comparison: Panic if
VX1 > VX2; Calm if contango > 5% and VIX/VIX3M < 0.95; otherwise Stressed.

## What the validation found

Out-of-sample period: 2014-01-02 → 2026-11-06 (3,232 days). Results are in
`backend/data/processed/regime/validation.json` and on the Diagnostics page.

**Bottom line: the HMM is not clearly better than the simple baseline.**

- **Where the HMM does better:**
  - Labels are far more stable: 11.8 flips per year versus 36.9 for the baseline. Spells have a
    median length of about 12–14 days, against 2–4 for the baseline.
  - It flags trouble earlier. It catches 64% of VIX-spike events (VIX up ≥ 30% within 5 days),
    against 37% for the baseline (median 8.5 days flagged before an event).
- **Where the baseline does better:**
  - The HMM labels **29% of days Panic**, against 15% for the baseline. This drives its false-alarm
    rate up: 59% of non-spike days are flagged, against 42%.
  - Its Panic-versus-Calm separation in next-day risk is weaker. The ratio of next-day UVXY
    standard deviation (Panic ÷ Calm) is 1.78 for the HMM and 2.00 for the baseline.
- **Where both fail the spec's expectation:** the next-day mean UVXY return in Panic is
  **negative** (HMM −0.45%, baseline −0.43%), not positive. Panic days have much wider ranges (HMM
  std 9.8% versus 5.5% in Calm; 99th percentile +30% versus +20%). They do not have an upward
  drift, because UVXY tends to fall back after spikes.
- **Ties:** both models flag 100% of days in every out-of-sample stress episode (2015, 2018,
  2020, 2024). On the in-sample episodes (2008, 2010, 2011) the HMM flags 100% and the baseline
  97% (92% of the 2010 flash crash). In 2017, 93% of days were labelled Calm by the HMM
  and 84% by the baseline.
- **A modelling caveat:** the contango-based naming does not line up with risk perfectly. The
  "Calm" state has about 40% *higher* realized volatility than "Stressed" (14.5% vs 10.3%), because contango
  mechanically widens as the front contract nears expiry.

**Suggested next steps**, to be judged on a held-out period and not tuned on the out-of-sample
years:
- Use a constant-maturity 30-day contango (interpolated by days to expiry) instead of raw VX2/VX1,
  to remove the roll sawtooth.
- Try 4 states, or drop `d_contango_5`.
- Name states by realized volatility rather than contango.

## Running it

Prerequisites: Python 3.11 + [`uv`](https://docs.astral.sh/uv/), Node 20.

```bash
# Backend
cd backend
uv sync
uv run python -m app.data.build_dataset        # download data, build the panel (~5 min first time)
uv run python -m app.regime.service            # train: walk-forward + live fit (~25 s)
uv run uvicorn app.main:app --port 8001        # API at http://localhost:8001/api/regime/...

# Frontend (separate terminal)
cd client
npm install
npm run dev                                    # http://localhost:5174 (proxies /api to :8001)
```

The ports (8001 / 5174) avoid clashing with the Monte Carlo simulator project, which uses 8000 / 5173.
Override them with `API_TARGET` / `CLIENT_PORT` for the client, and `--port` for uvicorn.

Tests: `cd backend && uv run pytest && uv run ruff check .` · `cd client && npm test && npm run build`.

## Retraining

- **From the UI:** use the **Retrain model** button on *Regime → Today*. It shows progress and the
  last trained time.
- **From the API:** `POST /api/regime/train`. It returns 409 if a run is already in progress,
  whether from the UI, the API or the CLI.
- **From the CLI:**
  - `uv run python -m app.data.build_dataset --refresh` fetches new market data.
  - `uv run python -m app.regime.service` refits everything.
  - `uv run python -m app.regime.service --validate-only` recomputes the validation report without
    refitting.

Training writes into a staging folder and swaps it in only on success, so the app never serves a
half-finished model.

**Resource use:** training fits 13 yearly folds in parallel worker processes, plus a live model.
The default is 4 workers with 1 BLAS thread each (`UVXY_TRAIN_N_JOBS`, `UVXY_TRAIN_BLAS_THREADS`).
A full retrain then takes about 25 s and keeps memory modest. Don't set the workers to "all cores"
on small machines: on a 12-core / 6 GB WSL host that oversubscribed CPU and memory badly enough to
stall the host, and it was also slower.

Every tunable number (features, number of states, restarts, refit frequency, hysteresis and
baseline thresholds, validation settings, jump detection) lives in
`backend/app/core/config.py`.

## Using it with the Monte Carlo simulator

`GET /api/regime/vix-params` returns per-regime spot-VIX process parameters, calibrated with the
simulator's own one-factor method (log-OU with exact `b = exp(−κ dt)` plus 3σ up-jump detection),
on out-of-sample days in each regime. It also returns a drop-in request fragment for today's
regime:

```json
{"simulator": {"model": "one_factor",
               "overrides": {"kappa": 9.87, "theta": 14.4, "sigma": 1.35,
                             "lam": 3.79, "mu_j": 0.398, "sigma_j": 0.118}}}
```

Send it as `model` + `overrides` to the simulator's `POST /api/simulate`. This is optional: the
regime detector runs on its own and does not need the simulator.

## Limitations

- **Describes risk, not direction.** The regimes separate the *size* of next-day moves, not
  their sign. Panic days had a slightly negative mean next-day return.
- **It cannot foresee news-driven regime changes.** The model reacts to the market, so a shock
  out of a calm market (for example a surprise announcement) shows up only after it hits prices. The
  "expected remaining duration" assumes the Markov chain's constant switching rate.
- **Pre-2014 episodes are in-sample.** 2008, the 2010 flash crash and 2011 fall inside the first
  training window, so they say little about real-time performance and are reported separately.
- **Data quality.**
  - VX1/VX2 are unadjusted front and second-month settlements, rolled the day before expiry.
  - UVXY's leverage changed from 2× to 1.5× in 2018, so return statistics mix both eras.
  - Free data sources (Cboe, FRED, Yahoo) can revise or briefly lag.
- **Per-regime VIX parameters are rough.** Each regime's AR(1) is fitted only on that regime's
  days, and the regime itself depends on the VIX level, which biases kappa and theta (long-run
  levels barely differ: Calm 14.3, Stressed 15.5, Panic 14.4). The simulator then applies one
  regime's dynamics for the whole horizon, although regimes switch.
- **Small samples in the tails.** P(next-day move > +30%) rests on a handful of days per regime.
