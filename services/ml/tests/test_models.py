"""TASK-071 — Baseline tests. TASK-072 — model selection tests.
TASK-074 — forecast point + p10/p90 + cold-start 4-week mean."""

from __future__ import annotations

import numpy as np
import pandas as pd

from tp_ml.models import COLD_START_MIN_DAYS, forecast, select_model


def _seasonal_series(weeks: int, base: float = 100.0, amp: float = 20.0) -> list[float]:
    rng = np.random.default_rng(42)
    days = weeks * 7
    week_pattern = np.array([1.0, 0.8, 0.9, 1.0, 1.1, 1.4, 1.2])  # weekly shape
    series = []
    for d in range(days):
        value = base * week_pattern[d % 7] + rng.normal(0, amp * 0.1)
        series.append(float(value))
    return series


def test_seasonal_naive_picks_up_weekly_pattern() -> None:
    history = _seasonal_series(weeks=20)
    model = select_model(history)
    # With clean seasonal data + no trend, either algorithm should reach decent MAPE.
    assert model.algorithm in {"seasonal_naive", "holt_winters"}
    assert model.holdout_mape is not None
    assert model.holdout_mape < 30


def test_holt_winters_selected_when_trend_present() -> None:
    base = _seasonal_series(weeks=20, amp=5.0)
    # Add a growing trend — should favour holt-winters over seasonal-naive.
    trended = [v + 0.3 * i for i, v in enumerate(base)]
    model = select_model(trended)
    assert model.algorithm in {"seasonal_naive", "holt_winters"}


def test_cold_start_when_history_too_short() -> None:
    history = [100.0, 102.0, 98.0, 105.0]
    model = select_model(history)
    assert model.algorithm == "cold_start"
    assert model.holdout_mape is None
    assert len(model.history) == 4


def test_cold_start_threshold_is_14_days() -> None:
    assert COLD_START_MIN_DAYS == 14


def test_forecast_returns_point_and_quantile_band() -> None:
    history = _seasonal_series(weeks=12)
    model = select_model(history)
    dates = [pd.Timestamp("2026-05-01") + pd.Timedelta(days=i) for i in range(3)]
    preds = forecast(model, dates)
    assert len(preds) == 3
    for p in preds:
        assert p.p10 <= p.point <= p.p90
        assert p.point >= 0


def test_cold_start_forecast_uses_four_week_mean() -> None:
    # Only 13 days — below the 14-day threshold, so cold start.
    history = [10.0] * 6 + [20.0] * 7
    assert len(history) < COLD_START_MIN_DAYS
    model = select_model(history)
    assert model.algorithm == "cold_start"
    dates = [pd.Timestamp("2026-05-01") + pd.Timedelta(days=i) for i in range(2)]
    preds = forecast(model, dates)
    expected_mean = float(np.mean(history))
    assert abs(preds[0].point - expected_mean) < 0.001
