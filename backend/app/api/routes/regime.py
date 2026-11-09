"""``/api/regime`` routes."""

from __future__ import annotations

import threading
from typing import Annotated

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.schemas.regime import (
    FoldInfo,
    RegimeDiagnostics,
    RegimeHindsight,
    RegimeHistory,
    RegimeLatest,
    RegimeVixParams,
    TrainStatus,
    TrainSummary,
)
from app.core.config import Settings, get_settings
from app.regime import service
from app.regime.hmm_model import prob_column

router = APIRouter(prefix="/api/regime", tags=["regime"])
SettingsDep = Annotated[Settings, Depends(get_settings)]
SPARKLINE_DAYS = 60
_training = threading.Event()


def _not_trained(exc: Exception) -> HTTPException:
    return HTTPException(status_code=404, detail=str(exc))


def _iso(ts) -> str:
    return pd.Timestamp(ts).date().isoformat()


def _f(x) -> float | None:
    return None if x is None or (isinstance(x, float) and not np.isfinite(x)) else float(x)


@router.post("/train", response_model=TrainSummary)
def train(settings: SettingsDep) -> dict:
    """Run walk-forward + live fit. Blocks until done (about 2 minutes on the full history)."""
    if _training.is_set():
        raise HTTPException(status_code=409, detail="training already running")
    _training.set()
    try:
        return service.train(settings)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    finally:
        _training.clear()


@router.get("/status", response_model=TrainStatus)
def status(settings: SettingsDep) -> dict:
    try:
        s = service.load_json("train_summary", settings)
    except service.NotTrainedError:
        return {"trained": False, "training": _training.is_set()}
    return {
        "trained": True,
        "training": _training.is_set(),
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
    start: Annotated[str | None, Query(pattern=r"^\d{4}-\d{2}-\d{2}$")] = None,
    end: Annotated[str | None, Query(pattern=r"^\d{4}-\d{2}-\d{2}$")] = None,
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
    cols = [
        "p_calm",
        "p_stressed",
        "p_panic",
        "raw_label",
        "smoothed_label",
        "baseline_label",
        "in_sample",
        "fold_id",
        "vix",
        "contango",
        "uvxy_close",
    ]
    df = hist[cols].copy()
    df["uvxy_close"] = df["uvxy_close"].astype(object).where(df["uvxy_close"].notna(), None)
    df.insert(0, "date", [_iso(d) for d in df.index])
    return {
        "start": start,
        "end": end,
        "names": ["Calm", "Stressed", "Panic"],
        "rows": df.to_dict(orient="records"),
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
def hindsight(
    settings: SettingsDep,
    start: Annotated[str | None, Query(pattern=r"^\d{4}-\d{2}-\d{2}$")] = None,
) -> dict:
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
    return params | {"current_regime": str(live["smoothed_label"].iloc[-1])}
