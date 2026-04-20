"""TASK-075 — Forecasting baselines.

Two algorithms per v1.6 §6.12b / §9.1:

1. seasonal_naive: predict y_t = y_{t-7} (day-of-week seasonality).
2. holt_winters: additive trend + 7-day seasonal Holt-Winters (ETS).

The training pipeline (`select_model`) backtests both on an 8-week holdout and
returns whichever minimises MAPE. Cold-start (fewer than 14 days of history)
falls back to a 4-week mean (AC-6).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np
import pandas as pd

Algorithm = Literal["seasonal_naive", "holt_winters", "cold_start"]


@dataclass(frozen=True)
class Forecast:
    """A forecast for a single future period.

    `top_drivers` is a list of three short human-readable strings (GAP-06 /
    §6.12b AC-8) explaining the dominant factors behind `point`. These power the
    ForecastBadge tooltip in the web UI so the kitchen lead can sanity-check why
    the model arrived at this number before deciding whether to override it.
    """

    target_date: str  # ISO date
    point: float
    p10: float
    p90: float
    top_drivers: list[str]


@dataclass(frozen=True)
class TrainedModel:
    algorithm: Algorithm
    last_value: float
    params: dict[str, float]
    history: list[float]
    holdout_mape: float | None


COLD_START_MIN_DAYS = 14
HOLDOUT_WEEKS = 8
SEASON = 7


def _mape(actual: np.ndarray, pred: np.ndarray) -> float:
    """Mean absolute percentage error, ignoring zero actuals."""
    mask = actual != 0
    if mask.sum() == 0:
        return 0.0
    return float(np.mean(np.abs((actual[mask] - pred[mask]) / actual[mask])) * 100)


def _seasonal_naive_predict(history: np.ndarray, horizon: int) -> np.ndarray:
    out = np.empty(horizon, dtype=float)
    for i in range(horizon):
        idx = len(history) - SEASON + (i % SEASON)
        out[i] = history[idx] if idx >= 0 else float(history.mean())
    return out


def _holt_winters_predict(history: np.ndarray, horizon: int) -> np.ndarray:
    # Lazy import to keep cold start fast.
    try:
        from statsmodels.tsa.holtwinters import ExponentialSmoothing
    except ImportError:
        return _seasonal_naive_predict(history, horizon)

    try:
        fit = ExponentialSmoothing(
            history, trend="add", seasonal="add", seasonal_periods=SEASON,
            initialization_method="estimated",
        ).fit(optimized=True, remove_bias=False)
        return np.asarray(fit.forecast(horizon))
    except Exception:  # noqa: BLE001 — statsmodels may error on degenerate series
        return _seasonal_naive_predict(history, horizon)


def _cold_start_predict(history: np.ndarray, horizon: int) -> np.ndarray:
    # Average of last 4 weeks (or all history if fewer days).
    window = history[-28:] if len(history) >= 28 else history
    mean = float(window.mean()) if len(window) > 0 else 0.0
    return np.full(horizon, mean)


def select_model(history: list[float]) -> TrainedModel:
    """§6.12b AC-3 — pick algorithm by 8-week holdout MAPE."""
    arr = np.asarray(history, dtype=float)

    if len(arr) < COLD_START_MIN_DAYS:
        return TrainedModel(
            algorithm="cold_start",
            last_value=float(arr[-1]) if len(arr) else 0.0,
            params={},
            history=list(arr),
            holdout_mape=None,
        )

    holdout_days = min(HOLDOUT_WEEKS * SEASON, max(SEASON, len(arr) // 3))
    train = arr[:-holdout_days]
    actual = arr[-holdout_days:]

    if len(train) < SEASON * 2:
        # Too little training data for seasonal comparison — default to seasonal_naive.
        return TrainedModel(
            algorithm="seasonal_naive", last_value=float(arr[-1]),
            params={}, history=list(arr), holdout_mape=None,
        )

    sn_pred = _seasonal_naive_predict(train, holdout_days)
    hw_pred = _holt_winters_predict(train, holdout_days)

    sn_mape = _mape(actual, sn_pred)
    hw_mape = _mape(actual, hw_pred)

    best: Algorithm = "holt_winters" if hw_mape < sn_mape else "seasonal_naive"
    return TrainedModel(
        algorithm=best,
        last_value=float(arr[-1]),
        params={"sn_mape": sn_mape, "hw_mape": hw_mape},
        history=list(arr),
        holdout_mape=min(sn_mape, hw_mape),
    )


def _same_dow_avg(history: np.ndarray, dow_offset: int, weeks: int = 4) -> float:
    """Mean of the last `weeks` observations that share `dow_offset` with the
    target date (0 = same DoW as the most recent point)."""
    if len(history) < SEASON:
        return float(history.mean()) if len(history) else 0.0
    # Walk backwards picking every-7th value matching the target DoW.
    samples: list[float] = []
    # The most recent history point sits at index len-1; the target's DoW
    # offset relative to it is (dow_offset).
    base = len(history) - 1 - ((SEASON - dow_offset) % SEASON)
    while base >= 0 and len(samples) < weeks:
        samples.append(float(history[base]))
        base -= SEASON
    if not samples:
        return float(history.mean())
    return float(np.mean(samples))


def _seasonality_pct(history: np.ndarray, dow_offset: int) -> float:
    """How much the target day-of-week typically differs from the weekly mean."""
    if len(history) < SEASON * 2:
        return 0.0
    overall = float(history[-SEASON * 4:].mean()) if len(history) >= SEASON * 4 else float(history.mean())
    if overall == 0:
        return 0.0
    dow_mean = _same_dow_avg(history, dow_offset, weeks=4)
    return (dow_mean - overall) / overall * 100.0


def _trend_pct(history: np.ndarray) -> float:
    """Pct change of the most recent week vs the prior week."""
    if len(history) < SEASON * 2:
        return 0.0
    recent = float(history[-SEASON:].mean())
    prior = float(history[-SEASON * 2:-SEASON].mean())
    if prior == 0:
        return 0.0
    return (recent - prior) / prior * 100.0


def _drivers_for(history: np.ndarray, target_date: pd.Timestamp, algorithm: Algorithm) -> list[str]:
    """Three short human-readable drivers (§6.12b AC-8). Order matters — the
    UI renders them in the tooltip top-to-bottom."""
    if algorithm == "cold_start":
        return [
            "insufficient history — using 4-week rolling mean",
            "no seasonality data yet (need ≥14 days)",
            "no trend data yet (need ≥14 days)",
        ]

    # DoW offset of the target day relative to the most-recent history point.
    # Pandas' Timestamp.dayofweek: Monday=0 … Sunday=6. We use it directly as the
    # rotating offset within a week-of-7.
    dow_offset = int(target_date.dayofweek)
    same_dow = _same_dow_avg(history, dow_offset, weeks=4)
    season_pct = _seasonality_pct(history, dow_offset)
    trend_pct = _trend_pct(history)

    return [
        f"last 4 weeks same day-of-week avg = {same_dow:.1f}",
        f"seasonality adjustment = {season_pct:+.0f}%",
        f"recent trend = {trend_pct:+.0f}%",
    ]


def forecast(model: TrainedModel, target_dates: list[pd.Timestamp]) -> list[Forecast]:
    """Produce point + p10/p90 forecasts for each target date.

    Simple quantile band uses ±1.28 · residual std (≈ 80 % CI)."""
    horizon = len(target_dates)
    arr = np.asarray(model.history, dtype=float)

    if model.algorithm == "cold_start":
        preds = _cold_start_predict(arr, horizon)
        sigma = float(arr.std()) if len(arr) > 0 else 0.0
    elif model.algorithm == "holt_winters":
        preds = _holt_winters_predict(arr, horizon)
        resid = arr[-SEASON:] - _seasonal_naive_predict(arr[:-SEASON] if len(arr) > SEASON else arr, SEASON)
        sigma = float(resid.std()) if len(resid) > 0 else 0.0
    else:
        preds = _seasonal_naive_predict(arr, horizon)
        resid = arr[-SEASON:] - _seasonal_naive_predict(arr[:-SEASON] if len(arr) > SEASON else arr, SEASON)
        sigma = float(resid.std()) if len(resid) > 0 else 0.0

    band = 1.28 * sigma
    return [
        Forecast(
            target_date=d.strftime("%Y-%m-%d"),
            point=float(max(preds[i], 0.0)),
            p10=float(max(preds[i] - band, 0.0)),
            p90=float(preds[i] + band),
            top_drivers=_drivers_for(arr, d, model.algorithm),
        )
        for i, d in enumerate(target_dates)
    ]
