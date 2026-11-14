"""Deterministic workout plans constrained by goal, frequency, time and equipment."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .schemas import ExerciseId

Goal = Literal["strength", "hypertrophy", "general"]
Equipment = Literal["barbell", "dumbbells", "pullup_bar", "bodyweight"]

# Ordered by priority: compound lifts first.
POOL: list[tuple[ExerciseId, frozenset[str]]] = [
    ("squat", frozenset({"barbell", "bodyweight"})),
    ("bench", frozenset({"barbell", "dumbbells"})),
    ("deadlift", frozenset({"barbell"})),
    ("pull_up", frozenset({"pullup_bar"})),
    ("shoulder_press", frozenset({"barbell", "dumbbells"})),
    ("curl", frozenset({"barbell", "dumbbells"})),
]
NEEDS = dict(POOL)

GOAL_SCHEME: dict[Goal, tuple[int, int, int, float]] = {
    # sets, reps_low, reps_high, rest minutes
    "strength": (4, 3, 5, 3.0),
    "hypertrophy": (3, 8, 12, 1.5),
    "general": (3, 6, 10, 1.5),
}
WARMUP_MIN = 5.0
WORK_MIN_PER_SET = 1.0
MAX_ITEMS = 4


class PlanRequest(BaseModel):
    goal: Goal
    days_per_week: int = Field(ge=1, le=6)
    minutes_per_session: int = Field(ge=10, le=180)
    equipment: list[Equipment]

    @field_validator("equipment")
    @classmethod
    def at_least_one(cls, v: list[Equipment]) -> list[Equipment]:
        if not v:
            raise ValueError("choose at least one equipment option")
        return sorted(set(v))


class PlanItem(BaseModel):
    exercise: ExerciseId
    sets: int
    reps_low: int
    reps_high: int
    rest_min: float


class PlanDay(BaseModel):
    day: int
    items: list[PlanItem]
    estimated_minutes: float


class Plan(BaseModel):
    goal: Goal
    days: list[PlanDay]
    notes: list[str]


def _minutes(items: list[PlanItem]) -> float:
    return WARMUP_MIN + sum(i.sets * (WORK_MIN_PER_SET + i.rest_min) for i in items)


def build_plan(req: PlanRequest) -> Plan:
    sets, lo, hi, rest = GOAL_SCHEME[req.goal]
    have = set(req.equipment)
    available = [ex for ex, needs in POOL if needs & have]
    days: list[PlanDay] = []
    for d in range(req.days_per_week):
        offset = (d * 2) % len(available)
        order = available[offset:] + available[:offset]
        items: list[PlanItem] = []
        for ex in order[:MAX_ITEMS]:
            item = PlanItem(exercise=ex, sets=sets, reps_low=lo, reps_high=hi, rest_min=rest)
            if _minutes([*items, item]) <= req.minutes_per_session:
                items.append(item)
        if not items:  # very short session: shrink one lift until it fits
            item = PlanItem(exercise=order[0], sets=sets, reps_low=lo, reps_high=hi, rest_min=rest)
            while item.sets > 1 and _minutes([item]) > req.minutes_per_session:
                item.sets -= 1
            items = [item]
        days.append(PlanDay(day=d + 1, items=items, estimated_minutes=_minutes(items)))
    notes = [
        "Progress with Jim's suggestions: small load steps only after an easy set (RPE <= 7).",
        "Camera rep counting covers curl, squat and shoulder press; log other lifts manually.",
    ]
    return Plan(goal=req.goal, days=days, notes=notes)


def validate_plan(plan: Plan, req: PlanRequest) -> list[str]:
    problems: list[str] = []
    if len(plan.days) != req.days_per_week:
        problems.append(f"expected {req.days_per_week} days, got {len(plan.days)}")
    have = set(req.equipment)
    for day in plan.days:
        if day.estimated_minutes > req.minutes_per_session:
            problems.append(f"day {day.day} needs {day.estimated_minutes} minutes")
        for item in day.items:
            if not NEEDS[item.exercise] & have:
                problems.append(f"day {day.day}: {item.exercise} needs unavailable equipment")
    return problems
