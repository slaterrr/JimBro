"""Jim coach: grounded facts, tone variants, safety, bounded progression and fallbacks."""

from typing import Any

import pytest
from backend.jimbro.coach import (
    TONES,
    CoachFacts,
    ExerciseFacts,
    ModelUnavailable,
    RuleCoach,
    coach_reply,
    is_safety_concern,
    suggest_next,
)
from backend.jimbro.schemas import SetOut
from fastapi.testclient import TestClient


def make_set(weight: float, reps: int, rpe: float | None, unit: str = "kg", i: int = 0) -> SetOut:
    return SetOut(
        id=f"s{i}",
        session_id="x",
        exercise="curl",
        weight=weight,
        unit=unit,  # type: ignore[arg-type]
        reps=reps,
        rpe=rpe,
        source="manual",
        confidence=None,
        model_version=None,
        completed_at=f"2026-11-14T10:00:0{i}Z",
        reps_detail=[],
        avg_tut_ms=None,
    )


# --- progression ---------------------------------------------------------------


def test_no_history_suggests_nothing() -> None:
    assert suggest_next([]) is None


def test_easy_set_increases_weight_within_bounds() -> None:
    s = suggest_next([make_set(20, 10, 6)])
    assert s is not None
    assert s.weight > 20 and s.weight <= 20 * 1.05 + 1e-9
    assert s.unit == "kg" and s.reps == 10
    assert "RPE 6" in s.rationale


def test_hard_set_decreases_weight() -> None:
    s = suggest_next([make_set(20, 6, 9.5)])
    assert s is not None and s.weight < 20 and s.weight >= 20 * 0.9


def test_moderate_set_holds_weight_adds_rep() -> None:
    s = suggest_next([make_set(20, 8, 8)])
    assert s is not None and s.weight == 20 and s.reps == 9


def test_unknown_rpe_holds() -> None:
    s = suggest_next([make_set(20, 8, None)])
    assert s is not None and s.weight == 20 and s.reps == 8


def test_bodyweight_progresses_reps_not_load() -> None:
    s = suggest_next([make_set(0, 5, 6)])
    assert s is not None and s.weight == 0 and s.reps == 6


def test_progression_uses_latest_set_and_keeps_unit() -> None:
    s = suggest_next([make_set(100, 5, 9.5, "lb", 1), make_set(45, 10, 6, "lb", 2)])
    assert s is not None and s.unit == "lb" and s.weight > 45


def test_rounds_to_loadable_increment() -> None:
    s = suggest_next([make_set(21, 10, 6)])
    assert s is not None and (s.weight * 2) == int(s.weight * 2)  # 0.5 kg steps


# --- safety + tones ------------------------------------------------------------


@pytest.mark.parametrize(
    "text", ["my elbow has sharp pain", "I think I'm injured", "chest pain and dizzy"]
)
def test_safety_concern_detected(text: str) -> None:
    assert is_safety_concern(text)


def test_normal_talk_not_flagged() -> None:
    assert not is_safety_concern("what should I do for curls next?")


FACTS = CoachFacts(
    exercises=[
        ExerciseFacts(
            exercise="curl",
            last_weight=20,
            unit="kg",
            last_reps=10,
            last_rpe=6,
            avg_tut_ms=2400,
            sessions=3,
        )
    ],
    total_sessions=3,
)


def test_rule_coach_tones_share_facts_but_differ_in_style() -> None:
    replies = {t: RuleCoach().reply(FACTS, "what next for curls?", t) for t in TONES}
    assert set(TONES) == {"direct", "friendly", "silly", "hard"}
    assert len({r.text for r in replies.values()}) == 4
    for r in replies.values():
        assert "21" in r.text or "20.5" in r.text or "21.0" in r.text  # same grounded number
        assert r.suggestion is not None and r.suggestion.exercise == "curl"


def test_safety_reply_is_identical_regardless_of_tone() -> None:
    texts = {coach_reply(FACTS, "sharp pain in my knee", t, model=None).text for t in TONES}
    assert len(texts) == 1
    assert "stop" in next(iter(texts)).lower()


class StubModel:
    def __init__(self, result: Any = None, error: Exception | None = None) -> None:
        self.result = result
        self.error = error
        self.calls: list[tuple[str, str]] = []

    def complete(self, system: str, user: str) -> str:
        self.calls.append((system, user))
        if self.error:
            raise self.error
        return str(self.result)


def test_model_reply_used_when_valid_and_grounded() -> None:
    model = StubModel('{"text": "Nice work. Go 21 kg for 10."}')
    r = coach_reply(FACTS, "next?", "direct", model=model)
    assert r.source == "ai" and r.text == "Nice work. Go 21 kg for 10."
    system, user = model.calls[0]
    assert "direct" in system.lower()
    assert '"last_weight": 20' in user  # facts are passed as structured JSON
    assert r.suggestion is not None  # suggestion always computed by code, not the model


def test_model_timeout_falls_back() -> None:
    r = coach_reply(FACTS, "next?", "friendly", model=StubModel(error=ModelUnavailable("t")))
    assert r.source == "fallback" and r.text


@pytest.mark.parametrize("raw", ["not json", '{"nope": 1}', '{"text": ""}', '{"text": 5}'])
def test_malformed_model_output_falls_back(raw: str) -> None:
    assert coach_reply(FACTS, "next?", "silly", model=StubModel(raw)).source == "fallback"


def test_safety_short_circuits_model() -> None:
    model = StubModel('{"text": "push through it!"}')
    r = coach_reply(FACTS, "my shoulder hurts, sharp pain", "hard", model=model)
    assert model.calls == [] and r.source == "safety"


def test_empty_history_reply() -> None:
    r = coach_reply(CoachFacts(exercises=[], total_sessions=0), "hi", "friendly", model=None)
    assert r.suggestion is None and "log" in r.text.lower()


# --- API -----------------------------------------------------------------------


def test_coach_endpoint_grounds_on_logged_history(client: TestClient) -> None:
    sid = client.post("/v1/sessions", json={}).json()["id"]
    body = {
        "session_id": sid,
        "exercise": "curl",
        "weight": 20,
        "unit": "kg",
        "reps": 10,
        "rpe": 6,
        "source": "manual",
        "reps_detail": [],
    }
    client.post("/v1/sets/c1/complete", json=body)
    res = client.post("/v1/coach", json={"message": "what next?", "tone": "hard"})
    assert res.status_code == 200
    data = res.json()
    assert data["source"] in {"fallback", "ai"}
    assert data["suggestion"]["exercise"] == "curl"
    assert data["suggestion"]["weight"] == 21


def test_coach_endpoint_validates_tone(client: TestClient) -> None:
    res = client.post("/v1/coach", json={"message": "hi", "tone": "rude"})
    assert res.status_code == 422


def test_suggestion_endpoint(client: TestClient) -> None:
    assert client.get("/v1/suggestions/curl").json() is None
