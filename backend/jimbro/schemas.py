"""Public request/response contracts for workout logging (keep backward compatible)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

ExerciseId = Literal["curl", "squat", "bench", "deadlift", "shoulder_press", "pull_up"]
Unit = Literal["kg", "lb"]
Source = Literal["camera", "manual", "voice"]

ATHLETE_PATTERN = r"^[A-Za-z0-9_-]{1,40}$"


class Exercise(BaseModel):
    id: ExerciseId
    name: str
    camera_tracking: bool


EXERCISES: list[Exercise] = [
    Exercise(id="curl", name="Bicep curl", camera_tracking=True),
    Exercise(id="squat", name="Squat", camera_tracking=True),
    Exercise(id="bench", name="Bench press", camera_tracking=False),
    Exercise(id="deadlift", name="Deadlift", camera_tracking=False),
    Exercise(id="shoulder_press", name="Shoulder press", camera_tracking=True),
    Exercise(id="pull_up", name="Pull-up", camera_tracking=False),
]


class RepDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    index: int = Field(ge=1)
    concentric_ms: int = Field(ge=0)
    peak_pause_ms: int = Field(ge=0)
    eccentric_ms: int = Field(ge=0)


class RepDetailOut(RepDetail):
    tut_ms: int


class SetIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str = Field(min_length=1, max_length=64)
    exercise: ExerciseId
    weight: float = Field(ge=0, le=2000)
    unit: Unit
    reps: int = Field(ge=0, le=1000)
    rpe: float | None = Field(default=None, ge=1, le=10)
    source: Source = "manual"
    confidence: float | None = Field(default=None, ge=0, le=1)
    model_version: str | None = Field(default=None, max_length=64)
    reps_detail: list[RepDetail] = Field(default_factory=list, max_length=1000)

    @model_validator(mode="after")
    def detail_matches_reps(self) -> SetIn:
        if self.reps_detail and len(self.reps_detail) != self.reps:
            raise ValueError("reps_detail must have one entry per rep when provided")
        return self


class SetOut(BaseModel):
    id: str
    session_id: str
    exercise: ExerciseId
    weight: float
    unit: Unit
    reps: int
    rpe: float | None
    source: Source
    confidence: float | None
    model_version: str | None
    completed_at: str
    reps_detail: list[RepDetailOut]
    avg_tut_ms: int | None


class SessionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    notes: str | None = Field(default=None, max_length=500)


class SessionOut(BaseModel):
    id: str
    athlete_id: str
    started_at: str
    ended_at: str | None
    notes: str | None


class SessionSummary(SessionOut):
    sets: list[SetOut]
    total_reps: int
    volume: dict[str, float]
