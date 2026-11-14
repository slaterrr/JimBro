"""Jim, the coach: deterministic facts and progression, optional AI wording.

The model never decides numbers. Code computes the facts and the bounded next-set
suggestion; the model (when reachable) only phrases a reply in the chosen tone. Safety
concerns short-circuit to a fixed reply, and any model failure falls back to RuleCoach.
"""

from __future__ import annotations

import json
import math
import os
import re
from collections.abc import Sequence
from typing import Literal, Protocol

from pydantic import BaseModel, Field

from .schemas import ExerciseId, SetOut, Unit

Tone = Literal["direct", "friendly", "silly", "hard"]
TONES: tuple[Tone, ...] = ("direct", "friendly", "silly", "hard")
MODEL_ID = os.environ.get("JIMBRO_MODEL", "claude-opus-5-5")

INCREMENT: dict[str, float] = {"kg": 0.5, "lb": 2.5}
MAX_STEP = 0.05  # never change load by more than 5% per suggestion


class Suggestion(BaseModel):
    exercise: ExerciseId
    weight: float
    unit: Unit
    reps: int
    rationale: str


class ExerciseFacts(BaseModel):
    exercise: ExerciseId
    last_weight: float
    unit: Unit
    last_reps: int
    last_rpe: float | None
    avg_tut_ms: int | None
    sessions: int


class CoachFacts(BaseModel):
    exercises: list[ExerciseFacts]
    total_sessions: int


class CoachReply(BaseModel):
    text: str
    tone: Tone
    source: Literal["ai", "fallback", "safety"]
    suggestion: Suggestion | None = None


class CoachRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
    tone: Tone = "friendly"
    exercise: ExerciseId | None = None


# --- progression ---------------------------------------------------------------


def _fmt(w: float) -> str:
    return f"{w:g}"


def suggest_next(history: Sequence[SetOut]) -> Suggestion | None:
    """Bounded double progression from the most recent set of one exercise."""
    if not history:
        return None
    last = history[-1]
    inc = INCREMENT[last.unit]
    rpe = last.rpe
    weight, reps = last.weight, last.reps
    if rpe is None:
        why = "No RPE logged, so repeat the last set and rate how it felt."
    elif weight == 0:
        if rpe <= 8:
            reps += 1
            why = f"Bodyweight at RPE {_fmt(rpe)}: add one rep."
        else:
            why = f"Bodyweight at RPE {_fmt(rpe)}: hold reps and own the form."
    elif rpe <= 7:
        up = math.floor(weight * (1 + MAX_STEP) / inc) * inc
        weight = up if up > weight else weight + inc
        why = f"Last set was RPE {_fmt(rpe)} - room to add a little load."
    elif rpe >= 9.5:
        weight = max(0.0, math.ceil(weight * (1 - MAX_STEP) / inc) * inc)
        why = f"Last set was RPE {_fmt(rpe)} - back off slightly and keep reps clean."
    else:
        reps += 1
        why = f"RPE {_fmt(rpe)} is a good working effort: same load, one more rep."
    return Suggestion(
        exercise=last.exercise, weight=weight, unit=last.unit, reps=reps, rationale=why
    )


def build_facts(sets: Sequence[SetOut]) -> CoachFacts:
    by_ex: dict[str, list[SetOut]] = {}
    for s in sets:
        by_ex.setdefault(s.exercise, []).append(s)
    exercises = []
    for items in by_ex.values():
        last = items[-1]
        tuts = [s.avg_tut_ms for s in items if s.avg_tut_ms is not None]
        exercises.append(
            ExerciseFacts(
                exercise=last.exercise,
                last_weight=last.weight,
                unit=last.unit,
                last_reps=last.reps,
                last_rpe=last.rpe,
                avg_tut_ms=round(sum(tuts) / len(tuts)) if tuts else None,
                sessions=len({s.session_id for s in items}),
            )
        )
    return CoachFacts(exercises=exercises, total_sessions=len({s.session_id for s in sets}))


# --- safety --------------------------------------------------------------------

_SAFETY = re.compile(
    r"\b(sharp pain|chest pain|pain|hurts?|injur(ed|y)|dizz(y|iness)|faint|numb|"
    r"can'?t breathe|pop(ped)?)\b",
    re.IGNORECASE,
)
SAFETY_TEXT = (
    "Stop the set now. Pain, dizziness or numbness is a signal to rest, not push through. "
    "If it is sharp, persists, or you have chest pain or trouble breathing, get medical help. "
    "JimBro can't assess injuries."
)


def is_safety_concern(text: str) -> bool:
    return bool(_SAFETY.search(text))


# --- wording -------------------------------------------------------------------

TONE_STYLE: dict[Tone, str] = {
    "direct": "Direct: short, factual sentences. No fluff.",
    "friendly": "Friendly: warm and encouraging, like a supportive training partner.",
    "silly": "Silly: playful and goofy with a light joke, but the numbers stay exact.",
    "hard": "Hard: drill-sergeant intensity and tough love, never insulting or unsafe.",
}

_TEMPLATES: dict[Tone, str] = {
    "direct": "Next {name}: {w} {u} x {r}. {why}",
    "friendly": "Great work! For your next {name} set try {w} {u} for {r} reps. {why}",
    "silly": "Beep boop, Jim's gains computer says: {name}, {w} {u}, {r} reps. "
    "{why} Your muscles have been notified.",
    "hard": "No excuses. {name}: {w} {u}, {r} reps, every one clean. {why} Move.",
}

_NAMES = {
    "curl": "curls",
    "squat": "squats",
    "bench": "bench",
    "deadlift": "deadlifts",
    "shoulder_press": "shoulder press",
    "pull_up": "pull-ups",
}


class ModelUnavailable(Exception):
    """Raised by model adapters on timeout, network, refusal or API errors."""


class TextModel(Protocol):
    def complete(self, system: str, user: str) -> str: ...


class RuleCoach:
    """Offline, deterministic wording. Always available."""

    def reply(
        self, facts: CoachFacts, message: str, tone: Tone, suggestion: Suggestion | None = None
    ) -> CoachReply:
        if suggestion is None:
            suggestion = _default_suggestion(facts)
        if suggestion is None:
            text = {
                "direct": "No sets logged yet. Log one and I'll plan the next.",
                "friendly": "Let's get started! Log your first set and I'll suggest the next.",
                "silly": "My crystal dumbbell is empty. Log a set so I can see the future!",
                "hard": "Nothing logged. Nothing earned. Log a set.",
            }[tone]
            return CoachReply(text=text, tone=tone, source="fallback")
        text = _TEMPLATES[tone].format(
            name=_NAMES[suggestion.exercise],
            w=_fmt(suggestion.weight),
            u=suggestion.unit,
            r=suggestion.reps,
            why=suggestion.rationale,
        )
        return CoachReply(text=text, tone=tone, source="fallback", suggestion=suggestion)


def _default_suggestion(facts: CoachFacts) -> Suggestion | None:
    if not facts.exercises:
        return None
    f = facts.exercises[-1]
    fake = SetOut(
        id="facts",
        session_id="facts",
        exercise=f.exercise,
        weight=f.last_weight,
        unit=f.unit,
        reps=f.last_reps,
        rpe=f.last_rpe,
        source="manual",
        confidence=None,
        model_version=None,
        completed_at="",
        reps_detail=[],
        avg_tut_ms=f.avg_tut_ms,
    )
    return suggest_next([fake])


def system_prompt(tone: Tone) -> str:
    return (
        "You are Jim, the coach inside the JimBro workout tracker. Reply in 1-3 sentences. "
        f"Tone - {TONE_STYLE[tone]}\n"
        "Rules that never change with tone: only use numbers present in the FACTS or "
        "SUGGESTION JSON; never invent history; if suggesting a set, use SUGGESTION exactly; "
        "TUT is estimated movement timing, not muscle tension; you cannot diagnose injuries. "
        'Respond with JSON {"text": "..."}.'
    )


def coach_reply(
    facts: CoachFacts,
    message: str,
    tone: Tone,
    model: TextModel | None,
    suggestion: Suggestion | None = None,
) -> CoachReply:
    if is_safety_concern(message):
        return CoachReply(text=SAFETY_TEXT, tone=tone, source="safety")
    fallback = RuleCoach().reply(facts, message, tone, suggestion)
    if model is None:
        return fallback
    payload = {
        "FACTS": facts.model_dump(),
        "SUGGESTION": fallback.suggestion.model_dump() if fallback.suggestion else None,
        "USER_MESSAGE": message,
    }
    try:
        raw = model.complete(system_prompt(tone), json.dumps(payload, sort_keys=True))
        text = json.loads(raw)["text"]
    except (ModelUnavailable, ValueError, KeyError, TypeError):
        return fallback
    if not isinstance(text, str) or not text.strip():
        return fallback
    return CoachReply(text=text.strip(), tone=tone, source="ai", suggestion=fallback.suggestion)


# --- Claude adapter ------------------------------------------------------------

REPLY_SCHEMA = {
    "type": "object",
    "properties": {"text": {"type": "string"}},
    "required": ["text"],
    "additionalProperties": False,
}


class ClaudeModel:  # pragma: no cover - exercised manually against the live API
    """Claude Messages API via the official SDK, with a short timeout for the Pi."""

    def __init__(self, timeout_s: float = 12.0) -> None:
        import anthropic

        self._anthropic = anthropic
        self._client = anthropic.Anthropic(timeout=timeout_s, max_retries=1)

    def complete(self, system: str, user: str) -> str:
        a = self._anthropic
        try:
            response = self._client.beta.messages.create(
                model=MODEL_ID,
                max_tokens=1024,
                system=system,
                messages=[{"role": "user", "content": user}],
                output_config={
                    "effort": "low",
                    "format": {"type": "json_schema", "schema": REPLY_SCHEMA},
                },
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except (a.APIConnectionError, a.APITimeoutError, a.RateLimitError, a.APIStatusError) as e:
            raise ModelUnavailable(str(e)) from e
        if response.stop_reason == "refusal":
            raise ModelUnavailable("refused")
        for block in response.content:
            if block.type == "text":
                return str(block.text)
        raise ModelUnavailable("no text block")


def default_model() -> TextModel | None:  # pragma: no cover - depends on environment
    """Use Claude only when credentials are configured; otherwise stay fully offline."""
    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
        return None
    try:
        return ClaudeModel()
    except Exception:
        return None
