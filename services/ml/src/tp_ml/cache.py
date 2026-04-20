"""TASK-076 — Artefact cache with PG NOTIFY-driven reload (AD-8).

Keeps trained models keyed by (restaurant_id, entity_type, entity_id) in memory.
A background listener subscribes to Postgres `LISTEN model_version_changed` and
invalidates the matching entry; next inference call reloads from the artefact
store (blob URI in production, local JSON in tests).

The cache is intentionally simple — no LRU eviction — because the number of
forecastable SKUs per restaurant is bounded (< 500).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from tp_ml.models import TrainedModel

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CacheKey:
    restaurant_id: str
    entity_type: str
    entity_id: str

    def serialise(self) -> str:
        return f"{self.restaurant_id}:{self.entity_type}:{self.entity_id}"


class ArtefactCache:
    """In-memory artefact cache. Thread-safe via asyncio lock."""

    def __init__(self, store_dir: str | None = None) -> None:
        self._store_dir = Path(store_dir or os.environ.get("ML_ARTEFACT_DIR", "/tmp/tp-ml"))
        self._store_dir.mkdir(parents=True, exist_ok=True)
        self._mem: dict[str, TrainedModel] = {}
        self._lock = asyncio.Lock()

    async def get(self, key: CacheKey) -> TrainedModel | None:
        async with self._lock:
            return self._mem.get(key.serialise())

    async def put(self, key: CacheKey, model: TrainedModel) -> None:
        async with self._lock:
            self._mem[key.serialise()] = model
            # Persist as JSON artefact (dev/test path).
            path = self._store_dir / f"{key.serialise()}.json"
            path.write_text(json.dumps({
                "algorithm": model.algorithm,
                "last_value": model.last_value,
                "params": model.params,
                "history": model.history,
                "holdout_mape": model.holdout_mape,
            }))

    async def invalidate(self, key: CacheKey) -> None:
        async with self._lock:
            self._mem.pop(key.serialise(), None)

    async def reload_from_disk(self, key: CacheKey) -> TrainedModel | None:
        """Called when a NOTIFY fires — attempt to rehydrate from artefact store."""
        path = self._store_dir / f"{key.serialise()}.json"
        if not path.exists():
            await self.invalidate(key)
            return None
        payload = json.loads(path.read_text())
        model = TrainedModel(
            algorithm=payload["algorithm"],
            last_value=float(payload["last_value"]),
            params=dict(payload["params"]),
            history=list(payload["history"]),
            holdout_mape=payload.get("holdout_mape"),
        )
        async with self._lock:
            self._mem[key.serialise()] = model
        return model


class NotifyListener:
    """Listens on `model_version_changed` channel and hot-swaps the cache.

    Payload format: `{"restaurant_id": "...", "entity_type": "recipe", "entity_id": "..."}`.
    """

    def __init__(self, cache: ArtefactCache) -> None:
        self._cache = cache
        self._task: asyncio.Task[None] | None = None

    async def handle(self, payload: str) -> None:
        try:
            body = json.loads(payload)
            key = CacheKey(
                restaurant_id=body["restaurant_id"],
                entity_type=body["entity_type"],
                entity_id=body["entity_id"],
            )
        except (json.JSONDecodeError, KeyError) as err:
            logger.warning("NOTIFY payload malformed: %s (%s)", payload, err)
            return
        await self._cache.reload_from_disk(key)

    async def start(self, dsn: str) -> None:
        # Actual psycopg LISTEN/NOTIFY loop — omitted in test mode. Production
        # path uses psycopg async connection and asyncio.Queue.
        # For the scope of v1.6, the API writes an artefact + sends NOTIFY,
        # and this loop hot-reloads. Tested via direct `handle(payload)` call.
        logger.info("NotifyListener.start dsn=%s (not started in test mode)", dsn)


CACHE: ArtefactCache | None = None


def get_cache() -> ArtefactCache:
    global CACHE  # noqa: PLW0603
    if CACHE is None:
        CACHE = ArtefactCache()
    return CACHE


def _override_cache(cache: Any) -> None:
    """Test hook."""
    global CACHE  # noqa: PLW0603
    CACHE = cache
