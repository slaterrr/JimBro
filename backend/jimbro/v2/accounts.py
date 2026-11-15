"""Minimal account-scoped workout snapshot API core.

Kept separate from the legacy single-owner Pi API. Never trust a client-supplied user ID.
Synchronization uses revision checks, so an offline device cannot silently overwrite newer
server data. Mobile conflict resolution and an offline retry queue are separate client tasks.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import uuid
from datetime import UTC, datetime, timedelta

from .store import Store, now_iso


class Conflict(Exception):
    pass


class InvalidCredentials(Exception):
    pass


class Unauthorized(Exception):
    pass


def _hash_password(password: str, salt: bytes) -> str:
    return salt.hex() + ":" + hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 310_000).hex()


def _check_password(password: str, stored: str) -> bool:
    try:
        encoded_salt, _ = stored.split(":", 1)
        return hmac.compare_digest(_hash_password(password, bytes.fromhex(encoded_salt)), stored)
    except (ValueError, TypeError):
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class Accounts:
    def __init__(self, store: Store):
        self.store = store

    def register(self, email: str, password: str) -> dict:
        if not isinstance(email, str):
            raise ValueError("valid email required")
        email = email.strip().lower()
        if len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            raise ValueError("valid email required")
        if not isinstance(password, str) or len(password) < 12 or len(password) > 1024:
            raise ValueError("password must be 12-1024 characters")
        user_id = str(uuid.uuid4())
        digest = _hash_password(password, secrets.token_bytes(16))
        try:
            with self.store.tx() as conn:
                conn.execute("INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)",
                             (user_id, email, digest, now_iso()))
                conn.execute("INSERT INTO user_sync_state (user_id,revision,data,updated_at) VALUES (?,0,'{}',?)",
                             (user_id, now_iso()))
        except sqlite3.IntegrityError as exc:
            raise Conflict("account already exists") from exc
        return {"id": user_id, "email": email}

    def login(self, email: str, password: str) -> str:
        if not isinstance(email, str) or not isinstance(password, str):
            raise InvalidCredentials()
        with self.store.tx() as conn:
            record = conn.execute("SELECT id,password_hash FROM users WHERE email=?",
                                  (email.strip().lower(),)).fetchone()
            if record is None or not _check_password(password, record["password_hash"]):
                raise InvalidCredentials()
            token = secrets.token_urlsafe(32)
            now = datetime.now(UTC)
            conn.execute(
                "INSERT INTO auth_tokens (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)",
                (_token_hash(token), record["id"], now.isoformat(), (now + timedelta(days=7)).isoformat()))
        return token

    def who(self, token: str) -> str:
        if not isinstance(token, str) or not token or len(token) > 512:
            raise Unauthorized()
        with self.store.tx() as conn:
            record = conn.execute(
                "SELECT user_id FROM auth_tokens WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?",
                (_token_hash(token), datetime.now(UTC).isoformat())).fetchone()
        if record is None:
            raise Unauthorized()
        return record["user_id"]

    def logout(self, token: str) -> None:
        user_id = self.who(token)
        with self.store.tx() as conn:
            conn.execute("UPDATE auth_tokens SET revoked_at=? WHERE token_hash=? AND user_id=?",
                         (now_iso(), _token_hash(token), user_id))

    def get_snapshot(self, user_id: str) -> dict:
        with self.store.tx() as conn:
            row = conn.execute(
                "SELECT revision,data FROM user_sync_state WHERE user_id=?", (user_id,)).fetchone()
        if row is None:
            raise Unauthorized()
        return {"revision": row["revision"], "data": json.loads(row["data"])}

    def save_snapshot(self, user_id: str, data: dict, revision: int, key: str) -> dict:
        if not isinstance(data, dict) or not isinstance(revision, int) or revision < 0:
            raise ValueError("invalid snapshot or revision")
        if not isinstance(key, str) or not 1 <= len(key) <= 128:
            raise ValueError("Idempotency-Key must be 1-128 characters")
        payload = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
        if len(payload.encode("utf-8")) > 1_000_000:
            raise ValueError("snapshot too large")
        request_hash = hashlib.sha256(f"{revision}:{payload}".encode("utf-8")).hexdigest()
        with self.store.tx() as conn:
            conn.execute("BEGIN IMMEDIATE")
            prior = conn.execute(
                "SELECT request_hash,response FROM idempotency_keys WHERE user_id=? AND key=?",
                (user_id, key)).fetchone()
            if prior:
                if not hmac.compare_digest(prior["request_hash"], request_hash):
                    raise Conflict("idempotency key reused for different payload")
                return json.loads(prior["response"])
            row = conn.execute("SELECT revision FROM user_sync_state WHERE user_id=?",
                               (user_id,)).fetchone()
            if row is None:
                raise Unauthorized()
            if row["revision"] != revision:
                raise Conflict("stale revision; fetch latest and reconcile before retrying")
            response = {"revision": revision + 1, "data": json.loads(payload)}
            conn.execute("UPDATE user_sync_state SET revision=?,data=?,updated_at=? WHERE user_id=?",
                         (revision + 1, payload, now_iso(), user_id))
            conn.execute("INSERT INTO idempotency_keys "
                         "(user_id,key,request_hash,status_code,response,created_at) VALUES (?,?,?,?,?,?)",
                         (user_id, key, request_hash, 200,
                          json.dumps(response, sort_keys=True), now_iso()))
        return response
