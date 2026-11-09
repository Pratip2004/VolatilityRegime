"""``/api/regime`` routes."""

from __future__ import annotations

from datetime import date
from typing import Annotated

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException

from app.api.schemas.regime import (
    FoldInfo,
    RegimeDiagnostics,
    RegimeHindsight,
    RegimeHistory,
    RegimeInsights,
    RegimeLatest,
    RegimeVixParams,
    TrainStatus,
    TrainSummary,
)
from app.core.config import Settings, get_settings
from app.regime import service
from app.regime.hmm_model import prob_column
from app.regime.insights import build_insights, next_day_returns

router = APIRouter(prefix="/api/regime", tags=["regime"])
SettingsDep = Annotated[Settings, Depends(get_settings)]
SPARKLINE_DAYS = 60


def _not_trained(exc: Exception) -> HTTPException:
    return HTTPException(status_code=404, detail=str(exc))


def _iso(ts) -> str:
    return pd.Timestamp(ts).date().isoformat()


def _f(x) -> float | None:
    return None if x is None or (isinstance(x, float) and not np.isfinite(x)) else float(x)


@router.post("/train", response_model=TrainSummary)
def train(settings: SettingsDep) -> dict:
    """Run walk-forward + live fit. Blocks until done (about 2 minutes on the full history).
    Returns 409 if a run is already in progress (in this or another process)."""
    try:
        return service.train(settings, blocking=False)
    except service.TrainingInProgressError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/status", response_model=TrainStatus)
def status(settings: SettingsDep) -> dict:
    training = service.is_training()
    try:
        s = service.load_json("train_summary", settings)
    except service.NotTrainedError:
        return {"trained": False, "training": training}
    return {
        "trained": True,
        "training": training,
        "trained_at": s["trained_at"],
        "data_end": s["data_end"],
        "runtime_s": s["runtime_s"],
    }


@router.get("/latest", response_model=RegimeLatest)
def latest(settings: SettingsDep) -> dict:
    try:
        live = service.load_frame("live", settings)
        model = service.load_live_model(settings)
        risk = service.load_json("risk_stats", settings)
    except service.NotTrainedError as exc:
        raise _not_trained(exc) from exc
    try:
        trained_at = service.load_json("train_summary", settings)["trained_at"]
    except service.NotTrainedError:
        trained_at = None

    names = list(model.names)
    pcols = [prob_column(n) for n in names]
    today = live.iloc[-1]
    prev = live.iloc[-2] if len(live) > 1 else None
    p_today = today[pcols].to_numpy(dtype=float)

    feats_now = live[model.features].iloc[[-1]].to_numpy(dtype=float)
    z = model.scaler.transform(feats_now)[0]
    tail = live.iloc[-SPARKLINE_DAYS:]
    features = [
        {
            "name": f,
            "value": float(today[f]),
            "z_score": float(z[i]),
            "history": [
                {"date": _iso(d), "value": _f(v)} for d, v in zip(tail.index, tail[f], strict=True)
            ],
        }
        for i, f in enumerate(model.features)
    ]
    label = str(today["smoothed_label"])
    durations = model.expected_duration()
    return {
        "date": _iso(live.index[-1]),
        "smoothed_label": label,
        "raw_label": str(today["raw_label"]),
        "previous_label": None if prev is None else str(prev["smoothed_label"]),
        "changed_today": bool(prev is not None and prev["smoothed_label"] != label),
        "days_in_regime": int(today["days_in_regime"]),
        "probabilities": dict(zip(names, map(float, p_today), strict=True)),
        "features": features,
        "vix": float(today["vix"]),
        "vvix": float(today["vvix"]),
        "forecast": [
            {
                "horizon": h,
                "probabilities": dict(
                    zip(names, map(float, model.forecast(p_today, h)), strict=True)
                ),
            }
            for h in settings.regime.forecast_horizons
        ],
        "expected_remaining_duration": durations[label],
        "expected_duration": durations,
        "risk": risk["hmm"][label],
        "risk_period": risk["period"],
        "trained_at": trained_at,
    }


@router.get("/history", response_model=RegimeHistory)
def history(
    settings: SettingsDep,
    start: date | None = None,
    end: date | None = None,
) -> dict:
    try:
        hist = service.load_frame("history", settings)
    except service.NotTrainedError as exc:
        raise _not_trained(exc) from exc
    if start and end and start > end:
        raise HTTPException(status_code=422, detail="start must be <= end")
    if start:
        hist = hist[hist.index >= pd.Timestamp(start)]
    if end:
        hist = hist[hist.index <= pd.Timestamp(end)]
    pcols = [c for c in hist.columns if c.startswith("p_")]
    names = [c[2:].capitalize() for c in pcols]
    probs = hist[pcols].to_numpy(dtype=float)
    uvxy = hist["uvxy_close"].to_numpy(dtype=float)
    rows = [
        {
            "date": _iso(d),
            "probabilities": dict(zip(names, map(float, p), strict=True)),
            "raw_label": raw,
            "smoothed_label": sm,
            "baseline_label": base,
            "in_sample": bool(ins),
            "fold_id": fid,
            "vix": float(vix),
            "contango": float(cont),
            "uvxy_close": float(u) if np.isfinite(u) else None,
            "days_in_regime": int(dir_),
            "uvxy_next_ret": float(nr) if np.isfinite(nr) else None,
        }
        for d, p, raw, sm, base, ins, fid, vix, cont, u, dir_, nr in zip(
            hist.index,
            probs,
            hist["raw_label"],
            hist["smoothed_label"],
            hist["baseline_label"],
            hist["in_sample"],
            hist["fold_id"],
            hist["vix"],
            hist["contango"],
            uvxy,
            hist["days_in_regime"],
            next_day_returns(hist).to_numpy(dtype=float),
            strict=True,
        )
    ]
    return {
        "start": start.isoformat() if start else None,
        "end": end.isoformat() if end else None,
        "names": names,
        "rows": rows,
    }


@router.get("/diagnostics", response_model=RegimeDiagnostics)
def diagnostics(settings: SettingsDep) -> dict:
    try:
        model = service.load_live_model(settings)
        risk = service.load_json("risk_stats", settings)
        validation = service.load_json("validation", settings)
        vix_params = service.load_json("vix_params", settings)
    except service.NotTrainedError as exc:
        raise _not_trained(exc) from exc
    return {
        "names": list(model.names),
        "features": model.features,
        "transition_matrix": model.transmat.tolist(),
        "empirical_transition": risk["empirical_transition"],
        "state_means": model.state_means().to_dict(orient="index"),
        "state_stds": model.state_stds().to_dict(orient="index"),
        "expected_duration": model.expected_duration(),
        "durations": validation["durations"],
        "risk_stats": {"hmm": risk["hmm"], "baseline": risk["baseline"]},
        "risk_period": risk["period"],
        "validation": validation,
        "restarts": model.restarts,
        "live_log_likelihood": model.log_likelihood,
        "vix_params": vix_params,
    }


@router.get("/hindsight", response_model=RegimeHindsight)
def hindsight(settings: SettingsDep, start: date | None = None) -> dict:
    """Live-model filtered vs smoothed (forward-backward) probabilities. Smoothed values use
    future data and are for diagnostics only."""
    try:
        live = service.load_frame("live", settings)
        names = list(service.load_live_model(settings).names)
    except service.NotTrainedError as exc:
        raise _not_trained(exc) from exc
    if start:
        live = live[live.index >= pd.Timestamp(start)]
    pcols = [prob_column(n) for n in names]
    filt = live[pcols].to_numpy(dtype=float)
    smooth = live[[f"hs_{c}" for c in pcols]].to_numpy(dtype=float)
    rows = [
        {
            "date": _iso(d),
            "filtered": dict(zip(names, map(float, f), strict=True)),
            "smoothed": dict(zip(names, map(float, s), strict=True)),
        }
        for d, f, s in zip(live.index, filt, smooth, strict=True)
    ]
    return {
        "note": "Hindsight view: smoothed probabilities use data after each date. "
        "Not usable for trading or as a daily signal.",
        "rows": rows,
    }


@router.get("/folds", response_model=list[FoldInfo])
def folds(settings: SettingsDep) -> list[dict]:
    try:
        return service.load_folds(settings)
    except service.NotTrainedError as exc:
        raise _not_trained(exc) from exc


@router.get("/vix-params", response_model=RegimeVixParams)
def vix_params(settings: SettingsDep) -> dict:
    """Per-regime spot-VIX process parameters, plus today's regime, for the Monte Carlo
    simulator."""
    try:
        params = service.load_json("vix_params", settings)
        live = service.load_frame("live", settings)
    except service.NotTrainedError as exc:
        raise _not_trained(exc) from exc
    current = str(live["smoothed_label"].iloc[-1])
    return params | {
        "current_regime": current,
        "as_of": _iso(live.index[-1]),
        "simulator": simulator_overrides(params["by_regime"].get(current, {})),
    }


SIMULATOR_FIELDS = ("kappa", "theta", "sigma", "lam", "mu_j", "sigma_j")


def simulator_overrides(p: dict) -> dict | None:
    """One-factor overrides for the simulator, or None if the regime fit is incomplete (e.g. no
    mean reversion within the regime's days)."""
    vals = {k: p.get(k) for k in SIMULATOR_FIELDS}
    if any(v is None for v in vals.values()):
        return None
    return {"model": "one_factor", "overrides": {k: float(v) for k, v in vals.items()}}


@router.get("/insights", response_model=RegimeInsights)
def insights(settings: SettingsDep) -> dict:
    """Per-regime profiles, today's spell, every past episode and time spent per year
    (HMM smoothed labels)."""
    try:
        hist = service.load_frame("history", settings)
        risk = service.load_json("risk_stats", settings)
        names = list(service.load_live_model(settings).names)
    except service.NotTrainedError as exc:
        raise _not_trained(exc) from exc
    return build_insights(hist, names, risk["hmm"], settings.regime.first_train_end)
