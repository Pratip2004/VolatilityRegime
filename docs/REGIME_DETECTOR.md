# Volatility Regime Detector — Spec

Part of the UVXY risk project (see `CLAUDE.md`). Shares the same backend, data layer, stack and
UI conventions.

## Purpose

Label each trading day as **Calm**, **Stressed** or **Panic**, with a probability for each, using
only data available at that day's close. Regimes are persistent, so today's regime is the best
estimate of tomorrow's, and each regime has a very different distribution of next-day UVXY moves.
The detector therefore tells a trader **how risky tomorrow is likely to be** (range and tail size),
which drives position size, stop width and overnight-holding decisions.

### Non-goals

- It does **not** forecast UVXY direction. No UI text may imply it does.
- It does not place trades or give recommendations. Show the "not investment advice" note on every
  page.

---

## Data

Reuse the aligned daily panel from `app/data/build_dataset.py`. Required columns:
`date, vix, vix3m, vvix, vx1, vx2, spx_close, uvxy_close (adjusted)`.
If any are missing from the panel, add them to the data layer first (sources are listed in
`CLAUDE.md`). Default analysis window starts 2008-01-01 (VIX3M begins Dec 2007).

---

## Features — `app/regime/features.py`

Computed per day `t` from data up to and including `t` only:

| Name | Formula | Meaning |
|---|---|---|
| `contango` | `vx2 / vx1 - 1` | Term-structure slope; negative = backwardation |
| `vix_ratio` | `vix / vix3m` | Near-term vs 3-month fear; > 1 = panic signature |
| `log_vvix` | `ln(vvix)` | Volatility of VIX |
| `rv20` | `std(log SPX returns, 20d) * sqrt(252)` | Realized S&P 500 volatility |
| `vix_pct_252` | rolling 252-day percentile rank of VIX | Level relative to recent history |
| `d_contango_5` | `contango[t] - contango[t-5]` | Speed of curve change |

- The feature list is configurable in `core/config.py`; default model uses all six.
- Drop warm-up rows with NaNs (first ~252 days).
- **Scaling:** fit a `StandardScaler` on each walk-forward training window only and apply it to that
  fold's test window. Never fit a scaler on the full history.

---

## Model — `app/regime/hmm_model.py`

- `hmmlearn.hmm.GaussianHMM(n_components=3, covariance_type="full", n_iter=500, min_covar=1e-4)`.
- HMMs converge to local optima: fit with **10 random restarts** (seeds 0–9) and keep the model with
  the highest training log-likelihood. Log all restart scores.
- Number of states is configurable (2–4) for experiments; 3 is the default and the UI assumes 3 when
  using names.

### Filtered probabilities (mandatory)

`hmmlearn`'s `predict_proba` returns **smoothed** posteriors that use future data. Never use them for
anything shown as a daily signal or used in validation. Implement the forward algorithm in log space:

```
log_alpha[0] = log(startprob) + log_emission[0];          normalize
log_alpha[t] = logsumexp(log_alpha[t-1][:, None] + log(transmat), axis=0) + log_emission[t];  normalize
```

Emission log-densities from `scipy.stats.multivariate_normal(mean_s, cov_s).logpdf`.
Expose smoothed probabilities only on the diagnostics page, clearly labelled "hindsight view".

### State labelling

State indices are arbitrary and change between fits. After every fit, assign names by each state's
mean `contango` in original (unscaled) units, computed from training days where that state has the
highest filtered probability: highest = Calm, middle = Stressed, lowest = Panic. Store the
index→name mapping with the model. All downstream code works with names, never raw indices.

### Regime forecast

For horizon `h`: `p[t+h] = p[t] @ transmat^h`. Return h = 1, 5, 20 by default. Rows must sum to 1.
Also return expected remaining duration of the current regime: `1 / (1 - transmat[s, s])` days.

---

## Walk-forward training — `app/regime/walk_forward.py`

- Expanding window. First training window: 2008-01-01 → 2013-12-31. Then refit at a configurable
  frequency (default yearly; option: quarterly) and produce filtered probabilities for the next
  period only.
- The filtered probabilities for each test period are run through the forward algorithm continuing
  from the end of the training window, so the first test day has proper prior state probabilities.
- Persist every fold: `data/processed/regime/fold_<train_end>.joblib` plus a JSON with the scaler
  params, state mapping, log-likelihood, training window and feature list.
- The **live model** is a fit on all data up to the latest date, refit on demand.
- Concatenate test-period outputs into one out-of-sample history:
  `date, p_calm, p_stressed, p_panic, raw_label, smoothed_label, fold_id`.

---

## Label smoothing — `app/regime/smoothing.py`

Raw label = argmax of filtered probabilities. Smoothed label applies hysteresis:

- Switch to Calm or Stressed only when that regime's probability ≥ 0.60.
- Enter Panic when `p_panic` ≥ 0.70; leave Panic only when `p_panic` < 0.40.
- Otherwise keep the previous smoothed label.
- Thresholds live in config. Report flips per year for raw vs smoothed labels.

Also compute `days_in_regime` from the smoothed label.

---

## Baseline — `app/regime/baseline.py`

Rule-based comparison:
- Panic if `vx1 > vx2` (backwardation)
- Calm if `contango > 0.05` and `vix_ratio < 0.95`
- Stressed otherwise

Thresholds in config. Every diagnostic compares HMM vs baseline side by side. If the HMM is not
clearly better on the validation checks, say so plainly in the phase report.

---

## Regime-conditional risk statistics — `app/regime/risk_stats.py`

This is what makes the detector useful for the next day. For each smoothed regime, using the
regime at the close of day `t` and the UVXY return from close `t` to close `t+1` (strictly next
day, out-of-sample history only):

- count of days, mean, median, std of next-day UVXY return
- percentiles 1, 5, 25, 75, 95, 99
- probability of a next-day move above +10%, +20%, +30%
- probability of the next-day regime being each of the three regimes (empirical transition table)

Expose these as "expected next-day range" for the current regime. Also export per-regime spot-VIX
process parameters (re-using the calibration code from the Monte Carlo module on days in each
regime) so the simulator can start from today's regime.

---

## Validation — `app/regime/validation.py`

1. **Known episodes.** For each window below, the share of days labelled Stressed or Panic
   (out-of-sample, smoothed). Expected: high share.
   - 2008-09-15 → 2008-12-31 (financial crisis)
   - 2010-05-06 → 2010-06-30 (flash crash)
   - 2011-08-01 → 2011-10-31 (US downgrade / euro crisis)
   - 2015-08-20 → 2015-09-30 (China devaluation)
   - 2018-02-02 → 2018-02-28 (Volmageddon)
   - 2020-02-24 → 2020-04-30 (COVID)
   - 2024-08-01 → 2024-08-09 (carry-trade unwind)
   Note: episodes before 2014 fall inside the first training window, so report them separately as
   in-sample.
   Also report the share of 2017 labelled Calm (expected: very high).
2. **Economic separation.** Next-day UVXY mean return should be clearly negative in Calm and
   positive with much higher variance in Panic.
3. **Durations.** Distribution of spell lengths per regime; Panic spells should mostly be short.
4. **Stability.** Flips per year, raw vs smoothed.
5. **Spike lead time.** For days when VIX rose ≥ 30% within the next 5 days, the share preceded by a
   Stressed/Panic label (HMM vs baseline), and the false-alarm rate.

Write results to `data/processed/regime/validation.json`.

---

## API — `app/api/routes/regime.py`

| Method | Path | Returns |
|---|---|---|
| POST | `/api/regime/train` | Runs walk-forward + live fit; returns summary (folds, log-likelihoods, runtime) |
| GET | `/api/regime/latest` | Date, smoothed + raw label, probabilities, `days_in_regime`, feature values with z-scores, forecast for 1/5/20 days, expected remaining duration, next-day risk stats for the current regime, `changed_today` flag |
| GET | `/api/regime/history` | `?start=YYYY-MM-DD&end=` — daily probs, labels, VIX, contango, UVXY |
| GET | `/api/regime/diagnostics` | Transition matrix, state means (original units), duration stats, risk stats per regime, validation results, baseline comparison, restart log-likelihoods |
| GET | `/api/regime/folds` | List of walk-forward folds with metadata |

Pydantic v2 response models; mirror in `client/src/types/regime.ts`.

---

## Frontend

Add a "Regime" group to the Sider menu with three pages. Regime colours (use everywhere):
Calm `#22C55E`, Stressed `#F59E0B`, Panic `#EF4444`.

### `RegimeTodayPage.tsx` (overview shape)

- Header row: large AntD `Tag` with the smoothed regime, "as of" date, `days_in_regime`,
  and an `Alert` banner when `changed_today` is true.
- Probabilities: three AntD `Progress` bars (one per regime) with percentages.
- Stat grid (4 columns, AntD `Statistic`): contango %, VIX/VIX3M, VVIX, 20-day realized vol, each
  with its z-score and a small sparkline of the last 60 days.
- "Next-day risk" card: typical range (25–75th pct), bad case (99th pct), P(move > +20%), from
  `risk_stats` for the current regime, with the line "Describes the size of likely moves, not
  their direction."
- Forecast table (AntD `Table`): regime probabilities at 1, 5 and 20 days, plus expected remaining
  duration.
- "Retrain model" button (calls `/api/regime/train`, shows progress and last trained time).

### `RegimeHistoryPage.tsx`

- `DatePicker.RangePicker` with presets (1Y, 3Y, 5Y, All).
- Main chart: VIX line with coloured background bands per smoothed regime (Recharts `ReferenceArea`).
- Below: stacked area chart of filtered probabilities.
- Third chart: UVXY (log scale) with the same regime bands.
- `Segmented` toggle: HMM vs baseline labels.

### `RegimeDiagnosticsPage.tsx`

- Transition matrix as an AntD `Table` with cell background shaded by probability.
- State means table (original units).
- Duration histogram per regime.
- Next-day UVXY return stats per regime (`Table`), with a box-plot-style chart.
- Known-episodes table with share flagged and a pass/attention `Tag`.
- HMM vs baseline comparison table.
- Collapsible "Hindsight (smoothed) view" panel, labelled as not usable for trading.

Follow the UI conventions in `CLAUDE.md` (AntD v5 + Tailwind, `Typography` for text, one file per
page, loading/empty/error states).

---

## Tests — `backend/tests/regime/`

- **No look-ahead:** filtered probabilities for dates ≤ T are identical whether or not data after T
  is appended. This is the most important test.
- **Recovery:** sample from a known 3-state Gaussian HMM, fit, and recover means and transition
  matrix within tolerance (after label alignment).
- **Labelling:** permuting the state order of a fitted model yields the same names.
- **Forecast:** rows sum to 1; `h = 0` returns today's probabilities.
- **Hysteresis:** hand-built probability sequences produce the expected smoothed labels.
- **Walk-forward:** no test date ever appears in its own fold's training window; scaler fitted on
  training data only.
- **Risk stats:** uses next-day returns (shifted by exactly one day).
- API happy-path tests with fixture data, no network.
