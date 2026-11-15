"""Account API mounted under /v2, independent of the legacy Pi athlete header.

HTTPS, distributed rate limiting, account recovery, and mobile sync-queue integration are
required before exposing this service as a production internet API.
"""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from .accounts import Accounts, Conflict, InvalidCredentials, Unauthorized

router = APIRouter(prefix="/v2", tags=["accounts"])


def accounts(request: Request) -> Accounts:
    return request.app.state.accounts


Service = Annotated[Accounts, Depends(accounts)]


def bearer(authorization: Annotated[str | None, Header()] = None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="authentication required")
    return authorization[7:]


Token = Annotated[str, Depends(bearer)]


def identity(service: Service, token: Token) -> str:
    try:
        return service.who(token)
    except Unauthorized:
        raise HTTPException(status_code=401, detail="invalid or expired session") from None


User = Annotated[str, Depends(identity)]


class Credentials(BaseModel):
    email: str
    password: str


class SnapshotIn(BaseModel):
    revision: int = Field(ge=0)
    data: dict[str, Any]


@router.post("/auth/register", status_code=201)
def register(body: Credentials, service: Service) -> dict:
    try:
        return service.register(body.email, body.password)
    except ValueError as exc:
        raise HTTPException(422, detail=str(exc)) from None
    except Conflict:
        raise HTTPException(409, detail="account already exists") from None


@router.post("/auth/login")
def login(body: Credentials, service: Service) -> dict:
    try:
        return {"access_token": service.login(body.email, body.password), "token_type": "bearer"}
    except InvalidCredentials:
        raise HTTPException(401, detail="invalid email or password") from None


@router.post("/auth/logout")
def logout(service: Service, token: Token) -> dict:
    try:
        service.logout(token)
    except Unauthorized:
        raise HTTPException(401, detail="invalid or expired session") from None
    return {"ok": True}


@router.get("/sync")
def get_sync(service: Service, who: User) -> dict:
    return service.get_snapshot(who)


@router.put("/sync")
def put_sync(body: SnapshotIn, service: Service, who: User,
             idempotency_key: Annotated[str | None, Header()] = None) -> dict:
    if idempotency_key is None:
        raise HTTPException(400, detail="Idempotency-Key required")
    try:
        return service.save_snapshot(who, body.data, body.revision, idempotency_key)
    except ValueError as exc:
        raise HTTPException(422, detail=str(exc)) from None
    except Conflict:
        raise HTTPException(409, detail="sync conflict; fetch latest and reconcile") from None
