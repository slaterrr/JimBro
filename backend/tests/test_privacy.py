"""Athletes can export and erase their own data, and nobody else's."""

from typing import Any

from fastapi.testclient import TestClient

ALEX = {"X-Athlete-Id": "alex"}
SAM = {"X-Athlete-Id": "sam"}


def log(client: TestClient, headers: dict[str, str], set_id: str) -> str:
    sid = str(client.post("/v1/sessions", json={}, headers=headers).json()["id"])
    body: dict[str, Any] = {
        "session_id": sid,
        "exercise": "curl",
        "weight": 10,
        "unit": "kg",
        "reps": 2,
        "source": "camera",
        "reps_detail": [
            {"index": i, "concentric_ms": 500, "peak_pause_ms": 0, "eccentric_ms": 700}
            for i in (1, 2)
        ],
    }
    assert client.post(f"/v1/sets/{set_id}/complete", json=body, headers=headers).status_code == 201
    return sid


def test_export_contains_only_own_data(client: TestClient) -> None:
    log(client, ALEX, "a1")
    log(client, SAM, "s1")
    client.put(
        "/v1/athletes/me", json={"display_name": "Alex", "leaderboard_opt_in": True}, headers=ALEX
    )
    data = client.get("/v1/export", headers=ALEX).json()
    assert data["athlete"]["display_name"] == "Alex"
    assert [s["id"] for s in data["sets"]] == ["a1"]
    assert len(data["sessions"]) == 1
    assert data["sets"][0]["reps_detail"][1]["tut_ms"] == 1200
    assert data["format"] == "jimbro-export-v1"


def test_delete_requires_confirmation(client: TestClient) -> None:
    log(client, ALEX, "a1")
    assert client.delete("/v1/athletes/me", headers=ALEX).status_code == 422
    assert client.get("/v1/export", headers=ALEX).json()["sets"]


def test_delete_erases_only_own_data(client: TestClient) -> None:
    alex_session = log(client, ALEX, "a1")
    log(client, SAM, "s1")
    res = client.delete("/v1/athletes/me?confirm=true", headers=ALEX)
    assert res.status_code == 200 and res.json() == {"deleted_sessions": 1, "deleted_sets": 1}
    assert client.get("/v1/export", headers=ALEX).json()["sets"] == []
    assert client.get(f"/v1/sessions/{alex_session}/summary", headers=ALEX).status_code == 404
    assert [s["id"] for s in client.get("/v1/export", headers=SAM).json()["sets"]] == ["s1"]
    # the freed set id can be reused after erasure
    log(client, ALEX, "a1")
