"""Workout plans must respect goal, frequency, time and equipment constraints."""

import pytest
from backend.jimbro.plans import PlanRequest, build_plan, validate_plan
from fastapi.testclient import TestClient

EQUIPMENT_FOR = {
    "curl": {"dumbbells", "barbell"},
    "squat": {"barbell", "bodyweight"},
    "bench": {"barbell", "dumbbells"},
    "deadlift": {"barbell"},
    "shoulder_press": {"dumbbells", "barbell"},
    "pull_up": {"pullup_bar"},
}


@pytest.mark.parametrize("days", [1, 2, 3, 4, 5, 6])
@pytest.mark.parametrize("goal", ["strength", "hypertrophy", "general"])
def test_plan_has_requested_days_and_fits_time(days: int, goal: str) -> None:
    req = PlanRequest(
        goal=goal,
        days_per_week=days,
        minutes_per_session=45,
        equipment=["barbell", "dumbbells", "pullup_bar", "bodyweight"],
    )
    plan = build_plan(req)
    assert len(plan.days) == days
    for day in plan.days:
        assert day.estimated_minutes <= 45
        assert day.items
    assert validate_plan(plan, req) == []


def test_equipment_constraint_respected() -> None:
    req = PlanRequest(
        goal="general", days_per_week=3, minutes_per_session=40, equipment=["dumbbells"]
    )
    plan = build_plan(req)
    used = {i.exercise for d in plan.days for i in d.items}
    assert used and all("dumbbells" in EQUIPMENT_FOR[e] for e in used)
    assert "deadlift" not in used and "pull_up" not in used


def test_bodyweight_only() -> None:
    req = PlanRequest(
        goal="general", days_per_week=2, minutes_per_session=30, equipment=["bodyweight"]
    )
    used = {i.exercise for d in build_plan(req).days for i in d.items}
    assert used == {"squat"}


def test_goal_changes_rep_ranges() -> None:
    base = dict(days_per_week=3, minutes_per_session=60, equipment=["barbell"])
    strength = build_plan(PlanRequest(goal="strength", **base))
    hyper = build_plan(PlanRequest(goal="hypertrophy", **base))
    s_reps = max(i.reps_high for d in strength.days for i in d.items)
    h_reps = min(i.reps_low for d in hyper.days for i in d.items)
    assert s_reps <= 6 < h_reps


def test_short_sessions_drop_items_not_time_limit() -> None:
    req = PlanRequest(
        goal="hypertrophy",
        days_per_week=3,
        minutes_per_session=15,
        equipment=["barbell", "dumbbells"],
    )
    for d in build_plan(req).days:
        assert d.estimated_minutes <= 15 and len(d.items) >= 1


def test_validator_catches_violations() -> None:
    req = PlanRequest(
        goal="general", days_per_week=2, minutes_per_session=30, equipment=["dumbbells"]
    )
    plan = build_plan(req)
    plan.days[0].items[0].exercise = "deadlift"
    plan.days[0].estimated_minutes = 99
    plan.days.pop()
    problems = validate_plan(plan, req)
    assert any("days" in p for p in problems)
    assert any("equipment" in p for p in problems)
    assert any("minutes" in p for p in problems)


def test_impossible_equipment_rejected() -> None:
    with pytest.raises(ValueError):
        PlanRequest(goal="general", days_per_week=2, minutes_per_session=30, equipment=[])


def test_deterministic() -> None:
    req = PlanRequest(
        goal="strength",
        days_per_week=4,
        minutes_per_session=50,
        equipment=["barbell", "pullup_bar"],
    )
    assert build_plan(req) == build_plan(req)


def test_plan_endpoint(client: TestClient) -> None:
    res = client.post(
        "/v1/plans",
        json={
            "goal": "strength",
            "days_per_week": 3,
            "minutes_per_session": 45,
            "equipment": ["barbell"],
        },
    )
    assert res.status_code == 200
    assert len(res.json()["days"]) == 3
    bad = client.post(
        "/v1/plans",
        json={
            "goal": "strength",
            "days_per_week": 9,
            "minutes_per_session": 45,
            "equipment": ["barbell"],
        },
    )
    assert bad.status_code == 422
