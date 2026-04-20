from __future__ import annotations

import os
from datetime import datetime, timezone

import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from tp_ml import __version__
from tp_ml.cache import CacheKey, get_cache
from tp_ml.models import Forecast, TrainedModel, forecast, select_model

app = FastAPI(title="TP Manager ML", version=__version__)


class TrainRequest(BaseModel):
    restaurant_id: str
    entity_type: str
    entity_id: str
    history: list[float] = Field(..., description="Daily observed values (oldest → newest)")


class TrainResponse(BaseModel):
    algorithm: str
    holdout_mape: float | None
    history_length: int


class ForecastRequest(BaseModel):
    restaurant_id: str
    entity_type: str
    entity_id: str
    target_dates: list[str] = Field(..., description="ISO dates to predict for")


class ForecastPoint(BaseModel):
    target_date: str
    point: float
    p10: float
    p90: float
    algorithm: str
    top_drivers: list[str]


class ForecastResponse(BaseModel):
    model_version: str
    algorithm: str
    predictions: list[ForecastPoint]


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "ml",
        "version": os.environ.get("APP_VERSION", __version__),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/readyz")
async def readyz() -> dict[str, object]:
    return {
        "status": "ready",
        "service": "ml",
        "checks": {"db": "skipped", "artefact_cache": "ok"},
    }


@app.post("/v1/train", response_model=TrainResponse)
async def train(req: TrainRequest) -> TrainResponse:
    model = select_model(req.history)
    cache = get_cache()
    await cache.put(
        CacheKey(req.restaurant_id, req.entity_type, req.entity_id),
        model,
    )
    return TrainResponse(
        algorithm=model.algorithm,
        holdout_mape=model.holdout_mape,
        history_length=len(model.history),
    )


@app.post("/v1/forecast", response_model=ForecastResponse)
async def forecast_endpoint(req: ForecastRequest) -> ForecastResponse:
    key = CacheKey(req.restaurant_id, req.entity_type, req.entity_id)
    cache = get_cache()
    model: TrainedModel | None = await cache.get(key)
    if model is None:
        model = await cache.reload_from_disk(key)
    if model is None:
        raise HTTPException(status_code=404, detail="model not found; train first")

    try:
        target_timestamps = [pd.Timestamp(d) for d in req.target_dates]
    except ValueError as err:
        raise HTTPException(status_code=400, detail=f"invalid date: {err}") from err

    preds: list[Forecast] = forecast(model, target_timestamps)
    return ForecastResponse(
        model_version=f"{model.algorithm}@{datetime.now(timezone.utc).isoformat()}",
        algorithm=model.algorithm,
        predictions=[
            ForecastPoint(
                target_date=p.target_date,
                point=p.point,
                p10=p.p10,
                p90=p.p90,
                algorithm=model.algorithm,
                top_drivers=p.top_drivers,
            )
            for p in preds
        ],
    )
