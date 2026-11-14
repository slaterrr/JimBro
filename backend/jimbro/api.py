"""HTTP surface for the JimBro backend running on the Raspberry Pi."""

import os
from pathlib import Path
from typing import Annotated, Literal

from fastapi import (
    APIRouter,
    Depends,
    FastAPI,
    Header,
    HTTPException,
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
from .db import Conflict, Database, NotFound
from .live import LiveSession
from .reps import MOVEMENTS
from .schemas import (
    ATHLETE_PATTERN,
    EXERCISES,
    Exercise,
    ExerciseId,
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


DB = Annotated[Database, Depends(get_db)]
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
def complete_set(set_id: str, body: SetIn, db: DB, who: Athlete, response: Response) -> SetOut:
    try:
        record, created = db.complete_set(who, set_id, body)
    except NotFound:
        raise HTTPException(404, "session not found") from None
    except Conflict:
        raise HTTPException(409, "set id already used with a different payload") from None
    if not created:
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

    @app.get("/health")
    def health() -> dict[str, str]:
        """Report service readiness without exposing sensitive configuration."""
        return {"status": "ok"}

    @app.websocket("/v1/live/{movement}")
    async def live(websocket: WebSocket, movement: str) -> None:
        if movement not in MOVEMENTS:
            await websocket.close(code=4404, reason="unknown movement")
            return
        await websocket.accept()
        session = LiveSession(movement)
        await websocket.send_json(session.state_event())
        try:
            while True:
                for event in session.handle(await websocket.receive_json()):
                    await websocket.send_json(event)
        except WebSocketDisconnect:
            return

    app.include_router(router)
    if static_dir is not None and (static_dir / "index.html").is_file():
        mount_pwa(app, static_dir)
    return app


def mount_pwa(app: FastAPI, static_dir: Path) -> None:
    """Serve built files, falling back to index.html for client-side routes."""
    root = static_dir.resolve()
    index = root / "index.html"

    @app.get("/{path:path}", include_in_schema=False)
    def pwa(path: str) -> FileResponse:
        if path.startswith("v1/"):
            raise HTTPException(404)
        candidate = (root / path).resolve()
        if candidate.is_file() and candidate.is_relative_to(root):
            return FileResponse(candidate)
        return FileResponse(index)


app = create_app()
