from fastapi.testclient import TestClient

from tp_ml.main import app


client = TestClient(app)


def test_healthz_returns_ok() -> None:
    resp = client.get("/healthz")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["service"] == "ml"


def test_readyz_returns_ready() -> None:
    resp = client.get("/readyz")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ready"
