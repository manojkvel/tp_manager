"""TASK-074 — forecast endpoint returns point + p10/p90; cold-start uses 4-week mean."""

from __future__ import annotations

from fastapi.testclient import TestClient

from tp_ml.main import app

client = TestClient(app)

RID = "rrrrrrrr-0000-4000-8000-000000000000"


def test_forecast_requires_training_first() -> None:
    resp = client.post(
        "/v1/forecast",
        json={
            "restaurant_id": RID, "entity_type": "recipe", "entity_id": "never-trained",
            "target_dates": ["2026-05-01"],
        },
    )
    assert resp.status_code == 404


def test_train_then_forecast_returns_point_and_band() -> None:
    history = [100.0 + (i % 7) * 5 for i in range(60)]  # weekly pattern
    r1 = client.post(
        "/v1/train",
        json={
            "restaurant_id": RID, "entity_type": "recipe", "entity_id": "burger",
            "history": history,
        },
    )
    assert r1.status_code == 200
    body = r1.json()
    assert body["algorithm"] in {"seasonal_naive", "holt_winters"}

    r2 = client.post(
        "/v1/forecast",
        json={
            "restaurant_id": RID, "entity_type": "recipe", "entity_id": "burger",
            "target_dates": ["2026-05-01", "2026-05-02", "2026-05-03"],
        },
    )
    assert r2.status_code == 200
    data = r2.json()
    assert len(data["predictions"]) == 3
    for p in data["predictions"]:
        assert p["p10"] <= p["point"] <= p["p90"]


def test_cold_start_uses_four_week_mean_when_history_short() -> None:
    history = [50.0] * 7  # only 7 days
    r1 = client.post(
        "/v1/train",
        json={
            "restaurant_id": RID, "entity_type": "recipe", "entity_id": "cold",
            "history": history,
        },
    )
    assert r1.status_code == 200
    assert r1.json()["algorithm"] == "cold_start"

    r2 = client.post(
        "/v1/forecast",
        json={
            "restaurant_id": RID, "entity_type": "recipe", "entity_id": "cold",
            "target_dates": ["2026-05-01"],
        },
    )
    assert r2.status_code == 200
    pt = r2.json()["predictions"][0]["point"]
    assert abs(pt - 50.0) < 0.001
