"""TASK-073 — NOTIFY-driven artefact cache reload (AD-8)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from tp_ml.cache import ArtefactCache, CacheKey, NotifyListener
from tp_ml.models import TrainedModel


@pytest.fixture
def cache(tmp_path: Path) -> ArtefactCache:
    return ArtefactCache(store_dir=str(tmp_path))


@pytest.fixture
def model() -> TrainedModel:
    return TrainedModel(
        algorithm="seasonal_naive",
        last_value=100.0,
        params={"sn_mape": 5.0, "hw_mape": 7.0},
        history=[100.0, 101.0, 99.0],
        holdout_mape=5.0,
    )


async def test_put_then_get(cache: ArtefactCache, model: TrainedModel) -> None:
    key = CacheKey("rest-1", "recipe", "r-1")
    await cache.put(key, model)
    got = await cache.get(key)
    assert got is not None
    assert got.algorithm == "seasonal_naive"
    assert got.last_value == 100.0


async def test_invalidate_removes_entry(cache: ArtefactCache, model: TrainedModel) -> None:
    key = CacheKey("rest-1", "recipe", "r-1")
    await cache.put(key, model)
    await cache.invalidate(key)
    assert await cache.get(key) is None


async def test_reload_from_disk_rehydrates_after_invalidate(
    cache: ArtefactCache, model: TrainedModel,
) -> None:
    key = CacheKey("rest-1", "recipe", "r-1")
    await cache.put(key, model)
    await cache.invalidate(key)
    reloaded = await cache.reload_from_disk(key)
    assert reloaded is not None
    assert reloaded.algorithm == "seasonal_naive"


async def test_notify_listener_handle_reloads(cache: ArtefactCache, model: TrainedModel) -> None:
    key = CacheKey("rest-1", "recipe", "r-1")
    await cache.put(key, model)
    await cache.invalidate(key)
    listener = NotifyListener(cache)
    payload = json.dumps({"restaurant_id": "rest-1", "entity_type": "recipe", "entity_id": "r-1"})
    await listener.handle(payload)
    assert (await cache.get(key)) is not None


async def test_notify_listener_ignores_malformed_payload(cache: ArtefactCache) -> None:
    listener = NotifyListener(cache)
    await listener.handle("not json")  # should not raise
    await listener.handle(json.dumps({"foo": "bar"}))  # missing fields
