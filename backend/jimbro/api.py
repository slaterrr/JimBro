"""HTTP surface for the JimBro backend running on the Raspberry Pi."""

import os
from pathlib import Path
from typing import Annotated

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

from .db import Conflict, Database, NotFound
from .live import LiveSession
from .reps import MOVEMENTS
from .schemas import (
    ATHLETE_PATTERN,
    EXERCISES,
    Exercise,
    SessionIn,
    SessionOut,
    SessionSummary,
    SetIn,
    SetOut,
)

DEFAULT_DB = Path(os.environ.get("JIMBRO_DB", "data/jimbro.db"))


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


def create_app(db_path: Path | str = DEFAULT_DB) -> FastAPI:
    app = FastAPI(title="JimBro", version="0.2.0")
    app.state.db = Database(db_path)

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
    return app


app = create_app()
