# Kickoff prompt — Volatility Regime Detector

Put `docs/REGIME_DETECTOR.md` in the project, then paste everything below the line into Claude Code
from the project root.

---

Read `CLAUDE.md` and `docs/REGIME_DETECTOR.md` fully before doing anything. We are adding a
volatility regime detector (Calm / Stressed / Panic) to this project: a Python backend module in
`backend/app/regime/`, API routes under `/api/regime`, and three new pages in the React + Vite +
TypeScript + Ant Design v5 frontend in `client/`.

First, add a short section to `CLAUDE.md` titled "Regime detector" that points to
`docs/REGIME_DETECTOR.md` and lists `app/regime/` and the three new pages in the repository layout.
Change nothing else in `CLAUDE.md`.

Then check what already exists. If the backend, data layer or client from the Monte Carlo build are
already in place, reuse them and don't recreate anything. If they don't exist yet, build only the
parts this module needs (Phase 0 and the data parts of Phase 1 from `CLAUDE.md`), then continue.

Before writing code, ask me structured clarifying questions about anything ambiguous in the spec
(use `/grill-me` if it's available). Only ask questions that would change the design.

Build in the phases below. At the end of each phase: run tests and ruff (and `npm run build` for
frontend phases), give me a short summary with the actual numbers, list open questions, and stop and
wait for my "continue".

**Phase R1 — Data and features**
Make sure the daily panel has every column the spec requires (fetch any missing series for real).
Implement `features.py`. Report the date range after warm-up, row count, summary statistics per
feature, and any gaps.

**Phase R2 — Model core**
Implement `hmm_model.py`: multi-restart fitting, forward-filtered probabilities in log space, state
labelling by mean contango, and the h-step forecast. Implement `smoothing.py` and `baseline.py`.
Write the no-look-ahead, recovery, labelling, forecast and hysteresis tests first and make them
pass. Fit once on all data and show me the state means in original units and the transition matrix.

**Phase R3 — Walk-forward and validation**
Implement `walk_forward.py`, `risk_stats.py` and `validation.py`. Run the full walk-forward. Report:
the known-episode table (in-sample and out-of-sample separately), share of 2017 labelled Calm,
next-day UVXY return stats per regime, spell durations, flips per year (raw vs smoothed), spike
lead-time results, and HMM vs baseline on every check. If the HMM is not clearly better than the
baseline, say so plainly and suggest what to change; don't tune on the out-of-sample period to hide it.

**Phase R4 — API**
Implement the `/api/regime` routes with Pydantic v2 response models and API tests using fixture
data. Show me a sample response from `/api/regime/latest` using real data.

**Phase R5 — Frontend**
Add the "Regime" menu group and build `RegimeTodayPage`, `RegimeHistoryPage` and
`RegimeDiagnosticsPage` exactly as specified, with typed TanStack Query hooks and TS types in
`client/src/types/regime.ts`. Use the regime colours from the spec everywhere. Handle loading, empty
and error states. Keep the "size of moves, not direction" wording and the not-investment-advice note.

**Phase R6 — Integration and docs**
Export per-regime spot-VIX parameters so the Monte Carlo simulator can start from today's regime;
if the simulator exists, add a "Use today's regime" switch to its form. Update `README.md` with a
plain-English explanation of the detector, how to retrain it, and its limitations (describes risk,
not direction; can't foresee news-driven regime changes; pre-2014 episodes are in-sample).
