"""Progress trends, weekly leaderboard and athlete profile."""

from typing import Any

from backend.jimbro.progress import percent_change, rank, trend
from backend.jimbro.schemas import SetOut
from fastapi.testclient import TestClient


def mk(
    session: str, weight: float, reps: int, unit: str = "kg", t: str = "1", tut: int | None = None
) -> SetOut:
    return SetOut(
        id=f"{session}-{weight}-{reps}-{t}",
        session_id=session,
        exercise="curl",
        weight=weight,
        unit=unit,  # type: ignore[arg-type]
        reps=reps,
        rpe=None,
        source="manual",
        confidence=None,
        model_version=None,
        completed_at=f"2026-11-1{session[-1]}T10:00:0{t}Z",
        reps_detail=[],
        avg_tut_ms=tut,
    )


def test_percent_change_denominator_and_zero() -> None:
    assert percent_change(100, 110) == 10.0
    assert percent_change(80, 60) == -25.0
    assert percent_change(0, 10) is None
    assert percent_change(None, 10) is None


def test_trend_groups_by_session_and_unit() -> None:
    sets = [mk("s1", 10, 10), mk("s1", 12, 8, t="2"), mk("s2", 14, 8), mk("s3", 30, 8, "lb")]
    t = trend(sets)
    kg = t["kg"]
    assert [p.session_id for p in kg.points] == ["s1", "s2"]
    assert kg.points[0].top_weight == 12 and kg.points[0].volume == 196 and kg.points[0].reps == 18
    assert kg.top_weight_change_pct == round((14 - 12) / 12 * 100, 1)
    assert kg.volume_change_pct == round((112 - 196) / 196 * 100, 1)
    assert t["lb"].points[0].top_weight == 30
    assert t["lb"].top_weight_change_pct is None  # one session: nothing to compare


def test_trend_tut_average_ignores_missing() -> None:
    t = trend([mk("s1", 10, 10, tut=2000), mk("s1", 10, 10, t="2"), mk("s2", 10, 10, tut=3000)])
    assert [p.avg_tut_ms for p in t["kg"].points] == [2000, 3000]
    assert t["kg"].tut_change_pct == 50.0


def test_rank_competition_ties() -> None:
    rows = [("a", 10), ("b", 30), ("c", 10), ("d", 20)]
    assert rank(rows) == [(1, "b", 30), (2, "d", 20), (3, "a", 10), (3, "c", 10)]
    assert rank([]) == []


def log(client: TestClient, who: str, reps: int, unit: str = "kg", weight: float = 10) -> None:
    h = {"X-Athlete-Id": who}
    sid = client.post("/v1/sessions", json={}, headers=h).json()["id"]
    body: dict[str, Any] = {
        "session_id": sid,
        "exercise": "curl",
        "weight": weight,
        "unit": unit,
        "reps": reps,
        "source": "manual",
        "reps_detail": [],
    }
    client.post(f"/v1/sets/{who}-{reps}-{unit}/complete", json=body, headers=h)


def test_progress_endpoint(client: TestClient) -> None:
    log(client, "alex", 10)
    log(client, "alex", 12, weight=12)
    data = client.get("/v1/progress/curl", headers={"X-Athlete-Id": "alex"}).json()
    assert data["exercise"] == "curl"
    assert len(data["by_unit"]["kg"]["points"]) == 2
    assert client.get("/v1/progress/zumba").status_code == 422


def test_leaderboard_is_opt_in_and_ranks_ties(client: TestClient) -> None:
    for who, reps in [("alex", 20), ("sam", 20), ("kim", 50)]:
        log(client, who, reps)
    assert client.get("/v1/leaderboard").json()["entries"] == []
    for who, name in [("alex", "Alex"), ("sam", "Sam")]:
        r = client.put(
            "/v1/athletes/me",
            json={"display_name": name, "leaderboard_opt_in": True},
            headers={"X-Athlete-Id": who},
        )
        assert r.status_code == 200
    board = client.get("/v1/leaderboard").json()
    assert board["metric"] == "reps"
    assert [(e["rank"], e["display_name"], e["value"]) for e in board["entries"]] == [
        (1, "Alex", 20),
        (1, "Sam", 20),
    ]
    assert all(e["demo"] is False for e in board["entries"])


def test_leaderboard_sessions_metric_and_validation(client: TestClient) -> None:
    log(client, "alex", 5)
    client.put(
        "/v1/athletes/me",
        json={"display_name": "Alex", "leaderboard_opt_in": True},
        headers={"X-Athlete-Id": "alex"},
    )
    board = client.get("/v1/leaderboard?metric=sessions").json()
    assert board["entries"][0]["value"] == 1
    assert client.get("/v1/leaderboard?metric=kg").status_code == 422


def test_demo_seed_is_labeled_and_idempotent(client: TestClient) -> None:
    assert client.post("/v1/demo/seed").status_code == 200
    client.post("/v1/demo/seed")
    entries = client.get("/v1/leaderboard").json()["entries"]
    assert entries and all(e["demo"] for e in entries)
    assert all(e["display_name"].endswith("(demo)") for e in entries)
    assert len(entries) == len({e["display_name"] for e in entries})


def test_profile_roundtrip_and_validation(client: TestClient) -> None:
    h = {"X-Athlete-Id": "alex"}
    assert client.get("/v1/athletes/me", headers=h).json() == {
        "id": "alex",
        "display_name": None,
        "leaderboard_opt_in": False,
    }
    bad = client.put(
        "/v1/athletes/me", json={"display_name": "", "leaderboard_opt_in": True}, headers=h
    )
    assert bad.status_code == 422
