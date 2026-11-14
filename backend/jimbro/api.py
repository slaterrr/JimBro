"""HTTP surface for the initial JimBro backend milestone."""

from fastapi import FastAPI

app = FastAPI(title="JimBro", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    """Report service readiness without exposing sensitive configuration."""
    return {"status": "ok"}
