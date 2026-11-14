"""HTTP surface for the JimBro backend running on the Raspberry Pi."""

import os
import re
from pathlib import Path
from typing import Annotated, Literal

from fastapi import (
    APIRouter,
    Depends,
    FastAPI,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import FileResponse

from .coach import (
    CoachReply,
    CoachRequest,
    Suggestion,
    TextModel,
    build_facts,
    coach_reply,
    default_model,
    suggest_next,
)
from .db import Conflict, Database, NotFound, week_bounds
from .events import EventBus
from .live import LiveSession
from .plans import Plan, PlanRequest, build_plan
from .progress import UnitTrend, rank, trend
from .reps import MOVEMENTS
from .schemas import (
    ATHLETE_PATTERN,
    EXERCISES,
    AthleteIn,
    AthleteOut,
    Exercise,
    ExerciseId,
    Leaderboard,
    LeaderboardEntry,
    SessionIn,
    SessionOut,
    SessionSummary,
    SetIn,
    SetOut,
)

DEFAULT_DB = Path(os.environ.get("JIMBRO_DB", "data/jimbro.db"))
DEFAULT_STATIC = Path(os.environ.get("JIMBRO_STATIC", "apps/mobile/dist"))


def get_db(request: Request) -> Database:
    db: Database = request.app.state.db
    return db


def athlete(
    x_athlete_id: Annotated[str, Header(pattern=ATHLETE_PATTERN)] = "me",
) -> str:
    """Single-owner Pi by default; the header separates household members."""
    return x_athlete_id


def get_bus(request: Request) -> EventBus:
    bus: EventBus = request.app.state.bus
    return bus


DB = Annotated[Database, Depends(get_db)]
Bus = Annotated[EventBus, Depends(get_bus)]
Athlete = Annotated[str, Depends(athlete)]

router = APIRouter(prefix="/v1")


@router.get("/exercises")
def exercises() -> list[Exercise]:
    return EXERCISES


@router.post("/sessions", status_code=201)
def create_session(body: SessionIn, db: DB, who: Athlete) -> SessionOut:
    return db.create_session(who, body.notes)


@router.get("/sessions")
def list_sessions(db: DB, who: Athlete) -> list[SessionOut]:
    return db.list_sessions(who)


@router.post("/sessions/{session_id}/end")
def end_session(session_id: str, db: DB, who: Athlete) -> SessionOut:
    try:
        return db.end_session(who, session_id)
    except NotFound:
        raise HTTPException(404, "session not found") from None


@router.get("/sessions/{session_id}/summary")
def session_summary(session_id: str, db: DB, who: Athlete) -> SessionSummary:
    try:
        return db.summary(who, session_id)
    except NotFound:
        raise HTTPException(404, "session not found") from None


@router.post("/sets/{set_id}/complete", status_code=201)
def complete_set(
    set_id: str, body: SetIn, db: DB, who: Athlete, bus: Bus, response: Response
) -> SetOut:
    try:
        record, created = db.complete_set(who, set_id, body)
    except NotFound:
        raise HTTPException(404, "session not found") from None
    except Conflict:
        raise HTTPException(409, "set id already used with a different payload") from None
    if created:
        bus.publish(
            {
                "type": "set",
                "athlete_id": who,
                "exercise": record.exercise,
                "reps": record.reps,
                "weight": record.weight,
                "unit": record.unit,
                "avg_tut_ms": record.avg_tut_ms,
            }
        )
    else:
        response.status_code = 200
    return record


def get_model(request: Request) -> TextModel | None:
    model: TextModel | None = request.app.state.model
    return model


@router.post("/coach")
def coach(
    body: CoachRequest,
    db: DB,
    who: Athlete,
    model: Annotated[TextModel | None, Depends(get_model)],
) -> CoachReply:
    sets = db.sets_for_athlete(who)
    facts = build_facts(sets)
    focus = body.exercise or (sets[-1].exercise if sets else None)
    suggestion = suggest_next([s for s in sets if s.exercise == focus]) if focus else None
    return coach_reply(facts, body.message, body.tone, model, suggestion)


@router.post("/plans")
def plan(body: PlanRequest) -> Plan:
    return build_plan(body)


@router.get("/progress/{exercise}")
def progress(exercise: ExerciseId, db: DB, who: Athlete) -> dict[str, object]:
    by_unit: dict[str, UnitTrend] = trend(db.sets_for_athlete(who, exercise))
    return {"exercise": exercise, "by_unit": by_unit}


@router.get("/athletes/me")
def get_me(db: DB, who: Athlete) -> AthleteOut:
    return db.get_athlete(who)


@router.put("/athletes/me")
def put_me(body: AthleteIn, db: DB, who: Athlete) -> AthleteOut:
    return db.update_athlete(who, body)


@router.get("/leaderboard")
def leaderboard(
    db: DB,
    metric: Literal["reps", "sessions"] = "reps",
    week: Annotated[str | None, Query(pattern=r"^\d{4}-W\d{2}$")] = None,
) -> Leaderboard:
    try:
        label, start, end = week_bounds(week)
    except ValueError:
        raise HTTPException(422, "week does not exist") from None
    stats = db.weekly_stats(start, end)
    demo = {name: is_demo for name, is_demo, _, _ in stats}
    values = [
        (name, float(reps if metric == "reps" else sessions)) for name, _, reps, sessions in stats
    ]
    entries = [
        LeaderboardEntry(rank=r, display_name=n, value=v, demo=demo[n]) for r, n, v in rank(values)
    ]
    return Leaderboard(week=label, metric=metric, entries=entries)


@router.post("/demo/seed")
def demo_seed(db: DB) -> dict[str, int]:
    """Labeled sample athletes so the leaderboard can be demoed. Safe to call repeatedly."""
    seeded = 0
    for i, (name, reps) in enumerate([("Riley", 64), ("Jordan", 48), ("Casey", 48)], start=1):
        who = f"demo-{i}"
        db.update_athlete(
            who, AthleteIn(display_name=f"{name} (demo)", leaderboard_opt_in=True), True
        )
        if db.list_sessions(who):
            continue
        sid = db.create_session(who, "demo data").id
        body = SetIn(
            session_id=sid, exercise="curl", weight=10, unit="kg", reps=reps, source="manual"
        )
        db.complete_set(who, f"{who}-seed", body)
        seeded += 1
    return {"seeded": seeded}


@router.post("/station/button")
def station_button(bus: Bus) -> dict[str, int]:
    """Physical GPIO button (or a tap on the station screen)."""
    return {"seq": bus.publish({"type": "button"})["seq"]}


@router.get("/suggestions/{exercise}")
def suggestion(exercise: ExerciseId, db: DB, who: Athlete) -> Suggestion | None:
    return suggest_next(db.sets_for_athlete(who, exercise))


def create_app(
    db_path: Path | str = DEFAULT_DB,
    static_dir: Path | None = DEFAULT_STATIC,
    model: TextModel | None | Literal["auto"] = "auto",
) -> FastAPI:
    app = FastAPI(title="JimBro", version="0.3.0")
    app.state.db = Database(db_path)
    app.state.model = default_model() if model == "auto" else model
    app.state.bus = bus = EventBus()

    @app.get("/health")
    def health() -> dict[str, str]:
        """Report service readiness without exposing sensitive configuration."""
        return {"status": "ok"}

    @app.websocket("/v1/live/{movement}")
    async def live(websocket: WebSocket, movement: str, athlete: str = "me") -> None:
        if movement not in MOVEMENTS:
            await websocket.close(code=4404, reason="unknown movement")
            return
        if not re.fullmatch(ATHLETE_PATTERN, athlete):
            await websocket.close(code=4422, reason="invalid athlete")
            return
        await websocket.accept()
        session = LiveSession(movement)
        await websocket.send_json(session.state_event())
        try:
            while True:
                for event in session.handle(await websocket.receive_json()):
                    await websocket.send_json(event)
                    if event["type"] == "rep":
                        bus.publish({**event, "movement": movement, "athlete_id": athlete})
        except WebSocketDisconnect:
            return

    @app.websocket("/v1/station")
    async def station(websocket: WebSocket) -> None:
        await websocket.accept()
        queue = bus.subscribe()
        try:
            await websocket.send_json({"type": "hello", "last": bus.last})
            while True:
                await websocket.send_json(await queue.get())
        except WebSocketDisconnect:
            return
        finally:
            bus.unsubscribe(queue)

    app.include_router(router)
    if static_dir is not None and (static_dir / "index.html").is_file():
        mount_pwa(app, static_dir)
    return app


def mount_pwa(app: FastAPI, static_dir: Path) -> None:
    """Serve built files, falling back to index.html for client-side routes."""
    root = static_dir.resolve()
    index = root / "index.html"

    @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def pwa(path: str) -> FileResponse:
        if path.startswith("v1/"):
            raise HTTPException(404)
        candidate = (root / path).resolve()
        if candidate.is_file() and candidate.is_relative_to(root):
            return FileResponse(candidate)
        return FileResponse(index)


app = create_app()
