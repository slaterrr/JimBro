"""HTTP surface for the JimBro backend running on the Raspberry Pi."""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from .live import LiveSession
from .reps import MOVEMENTS

app = FastAPI(title="JimBro", version="0.1.0")


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
