"""End-to-end v2 API checks: tokens, account isolation, retry safety."""
from fastapi.testclient import TestClient

from jimbro.api import create_app


def test_account_sync_contract(tmp_path):
    app = create_app(db_path=tmp_path / "api.db", static_dir=None, model=None)
    with TestClient(app) as client:
        alice = {"email": "alice@example.com", "password": "alice-password-is-long"}
        bob = {"email": "bob@example.com", "password": "bob-password-is-long"}
        assert client.post("/v2/auth/register", json=alice).status_code == 201
        assert client.post("/v2/auth/register", json=bob).status_code == 201
        assert client.post("/v2/auth/register", json=alice).status_code == 409
        login_a = client.post("/v2/auth/login", json=alice)
        assert login_a.status_code == 200
        token_a = login_a.json()["access_token"]
        token_b = client.post("/v2/auth/login", json=bob).json()["access_token"]
        headers_a = {"Authorization": f"Bearer {token_a}"}
        headers_b = {"Authorization": f"Bearer {token_b}"}

        assert client.get("/v2/sync").status_code == 401
        assert client.get("/v2/sync", headers={"Authorization": "Bearer wrong"}).status_code == 401
        assert client.get("/v2/sync", headers=headers_a).json() == {"revision": 0, "data": {}}
        assert client.get("/v2/sync", headers=headers_b).json() == {"revision": 0, "data": {}}

        payload = {"revision": 0, "data": {"history": [{"id": "alice-workout"}]}}
        save_headers = {**headers_a, "Idempotency-Key": "alice-op-1"}
        first = client.put("/v2/sync", json=payload, headers=save_headers)
        assert first.status_code == 200
        assert first.json()["revision"] == 1
        assert client.put("/v2/sync", json=payload, headers=save_headers).json() == first.json()
        stale_headers = {**headers_a, "Idempotency-Key": "other-op"}
        assert client.put("/v2/sync", json=payload, headers=stale_headers).status_code == 409
        saved = client.get("/v2/sync", headers=headers_a).json()
        assert saved["data"]["history"][0]["id"] == "alice-workout"
        assert client.get("/v2/sync", headers=headers_b).json()["data"] == {}

        assert client.post("/v2/auth/logout", headers=headers_a).status_code == 200
        assert client.get("/v2/sync", headers=headers_a).status_code == 401
        assert client.get("/v2/sync", headers=headers_b).status_code == 200
