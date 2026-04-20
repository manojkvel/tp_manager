"""GAP-06 — top_drivers explainability (§6.12b AC-8).

Every forecast point must carry three human-readable drivers:
  1. "last 4 weeks same day-of-week avg = X"
  2. "seasonality adjustment = ±Y%"
  3. "recent trend = ±Z%"

These feed the ForecastBadge tooltip in the web UI.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from tp_ml.models import forecast, select_model


def _build_history(weeks: int = 12, base: float = 100.0) -> list[float]:
    rng = np.random.default_rng(7)
    days = weeks * 7
    pat = np.array([1.0, 0.8, 0.9, 1.0, 1.1, 1.4, 1.2])
    out = []
    for d in range(days):
        out.append(float(base * pat[d % 7] + rng.normal(0, 2)))
    return out


def test_forecast_returns_top_drivers_list_of_three() -> None:
    history = _build_history()
    model = select_model(history)
    dates = [pd.Timestamp("2026-05-01")]
    preds = forecast(model, dates)
    assert len(preds) == 1
    drivers = preds[0].top_drivers
    assert isinstance(drivers, list)
    assert len(drivers) == 3
    for d in drivers:
        assert isinstance(d, str)
        assert len(d) > 0


def test_driver_mentions_same_dow_average() -> None:
    history = _build_history()
    model = select_model(history)
    preds = forecast(model, [pd.Timestamp("2026-05-01")])
    text = " | ".join(preds[0].top_drivers).lower()
    assert "day-of-week" in text or "same-dow" in text or "dow" in text


def test_driver_mentions_seasonality() -> None:
    history = _build_history()
    model = select_model(history)
    preds = forecast(model, [pd.Timestamp("2026-05-01")])
    text = " | ".join(preds[0].top_drivers).lower()
    assert "season" in text


def test_driver_mentions_trend() -> None:
    history = _build_history()
    model = select_model(history)
    preds = forecast(model, [pd.Timestamp("2026-05-01")])
    text = " | ".join(preds[0].top_drivers).lower()
    assert "trend" in text


def test_cold_start_still_has_three_drivers() -> None:
    history = [10.0] * 6 + [20.0] * 7  # 13 days → cold start
    model = select_model(history)
    assert model.algorithm == "cold_start"
    preds = forecast(model, [pd.Timestamp("2026-05-01")])
    assert len(preds[0].top_drivers) == 3
    # Cold-start driver should say so
    text = " | ".join(preds[0].top_drivers).lower()
    assert "cold" in text or "insufficient" in text or "rolling mean" in text
