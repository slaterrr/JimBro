"""SQLite persistence (stdlib only, so it runs on a Pi from a USB stick).

Every write runs in one transaction; failures roll back. Set ids are client-generated
idempotency keys: a retry with the same payload returns the stored record, a different
payload under the same id is a conflict.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path

from .schemas import (
    AthleteIn,
    AthleteOut,
    RepDetail,
    RepDetailOut,
    SessionOut,
    SessionSummary,
    SetIn,
    SetOut,
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS athletes (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  athlete_id TEXT NOT NULL REFERENCES athletes(id),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS sessions_athlete ON sessions(athlete_id, started_at);
CREATE TABLE IF NOT EXISTS sets (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  exercise TEXT NOT NULL,
  weight REAL NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('kg', 'lb')),
  reps INTEGER NOT NULL CHECK (reps >= 0),
  rpe REAL,
  source TEXT NOT NULL,
  confidence REAL,
  model_version TEXT,
  completed_at TEXT NOT NULL,
  payload_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sets_session ON sets(session_id, completed_at);
CREATE TABLE IF NOT EXISTS rep_summaries (
  set_id TEXT NOT NULL REFERENCES sets(id),
  idx INTEGER NOT NULL,
  concentric_ms INTEGER NOT NULL,
  peak_pause_ms INTEGER NOT NULL,
  eccentric_ms INTEGER NOT NULL,
  PRIMARY KEY (set_id, idx)
);
"""


# Migration note (v0.4): athletes gained display_name, leaderboard_opt_in and demo.
# Added in place with ALTER TABLE so existing Pi databases keep their data.
ATHLETE_COLUMNS = {
    "display_name": "TEXT",
    "leaderboard_opt_in": "INTEGER NOT NULL DEFAULT 0",
    "demo": "INTEGER NOT NULL DEFAULT 0",
}


def week_bounds(week: str | None) -> tuple[str, datetime, datetime]:
    """ISO week 'YYYY-Www' (default: current UTC week) -> (label, start, end)."""
    if week is None:
        year, num, _ = datetime.now(UTC).isocalendar()
    else:
        y, w = week.split("-W")
        year, num = int(y), int(w)
    start = datetime.fromisocalendar(year, num, 1).replace(tzinfo=UTC)
    return f"{year}-W{num:02d}", start, start + timedelta(days=7)


class NotFound(Exception):
    pass


class Conflict(Exception):
    pass


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds")


def _insert_reps(conn: sqlite3.Connection, set_id: str, reps: list[RepDetail]) -> None:
    conn.executemany(
        "INSERT INTO rep_summaries VALUES (?, ?, ?, ?, ?)",
        [(set_id, r.index, r.concentric_ms, r.peak_pause_ms, r.eccentric_ms) for r in reps],
    )


class Database:
    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.tx() as conn:
            conn.executescript(SCHEMA)
            have = {r["name"] for r in conn.execute("PRAGMA table_info(athletes)")}
            for col, ddl in ATHLETE_COLUMNS.items():
                if col not in have:
                    conn.execute(f"ALTER TABLE athletes ADD COLUMN {col} {ddl}")

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")  # resilient to power loss on the Pi
        try:
            yield conn
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            conn.close()

    # sessions -----------------------------------------------------------------

    def create_session(self, athlete_id: str, notes: str | None) -> SessionOut:
        sid = uuid.uuid4().hex
        with self.tx() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO athletes (id, created_at) VALUES (?, ?)",
                (athlete_id, now_iso()),
            )
            conn.execute(
                "INSERT INTO sessions VALUES (?, ?, ?, NULL, ?)",
                (sid, athlete_id, now_iso(), notes),
            )
        return self.get_session(athlete_id, sid)

    def get_session(self, athlete_id: str, session_id: str) -> SessionOut:
        with self.tx() as conn:
            row = conn.execute(
                "SELECT * FROM sessions WHERE id = ? AND athlete_id = ?",
                (session_id, athlete_id),
            ).fetchone()
        if row is None:
            raise NotFound(session_id)
        return SessionOut(**dict(row))

    def end_session(self, athlete_id: str, session_id: str) -> SessionOut:
        self.get_session(athlete_id, session_id)
        with self.tx() as conn:
            conn.execute(
                "UPDATE sessions SET ended_at = COALESCE(ended_at, ?) WHERE id = ?",
                (now_iso(), session_id),
            )
        return self.get_session(athlete_id, session_id)

    def list_sessions(self, athlete_id: str, limit: int = 100) -> list[SessionOut]:
        with self.tx() as conn:
            rows = conn.execute(
                "SELECT * FROM sessions WHERE athlete_id = ? ORDER BY started_at DESC LIMIT ?",
                (athlete_id, limit),
            ).fetchall()
        return [SessionOut(**dict(r)) for r in rows]

    # sets ---------------------------------------------------------------------

    def complete_set(self, athlete_id: str, set_id: str, body: SetIn) -> tuple[SetOut, bool]:
        """Return (record, created). Raises NotFound or Conflict."""
        digest = hashlib.sha256(
            json.dumps([athlete_id, body.model_dump()], sort_keys=True).encode()
        ).hexdigest()
        self.get_session(athlete_id, body.session_id)
        with self.tx() as conn:
            existing = conn.execute(
                "SELECT payload_hash FROM sets WHERE id = ?", (set_id,)
            ).fetchone()
            if existing is not None:
                if existing["payload_hash"] != digest:
                    raise Conflict(set_id)
                created = False
            else:
                conn.execute(
                    "INSERT INTO sets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        set_id,
                        body.session_id,
                        body.exercise,
                        body.weight,
                        body.unit,
                        body.reps,
                        body.rpe,
                        body.source,
                        body.confidence,
                        body.model_version,
                        now_iso(),
                        digest,
                    ),
                )
                _insert_reps(conn, set_id, body.reps_detail)
                created = True
        return self._load_sets(conn_filter=("s.id = ?", (set_id,)))[0], created

    def _load_sets(self, conn_filter: tuple[str, tuple[object, ...]]) -> list[SetOut]:
        where, args = conn_filter
        with self.tx() as conn:
            rows = conn.execute(
                f"SELECT s.* FROM sets s WHERE {where} ORDER BY s.completed_at, s.id", args
            ).fetchall()
            out: list[SetOut] = []
            for row in rows:
                reps = [
                    RepDetailOut(
                        index=r["idx"],
                        concentric_ms=r["concentric_ms"],
                        peak_pause_ms=r["peak_pause_ms"],
                        eccentric_ms=r["eccentric_ms"],
                        tut_ms=r["concentric_ms"] + r["peak_pause_ms"] + r["eccentric_ms"],
                    )
                    for r in conn.execute(
                        "SELECT * FROM rep_summaries WHERE set_id = ? ORDER BY idx", (row["id"],)
                    )
                ]
                data = {k: row[k] for k in row.keys() if k != "payload_hash"}
                avg = round(sum(r.tut_ms for r in reps) / len(reps)) if reps else None
                out.append(SetOut(**data, reps_detail=reps, avg_tut_ms=avg))
        return out

    def sets_for_athlete(self, athlete_id: str, exercise: str | None = None) -> list[SetOut]:
        where = "s.session_id IN (SELECT id FROM sessions WHERE athlete_id = ?)"
        args: tuple[object, ...] = (athlete_id,)
        if exercise is not None:
            where += " AND s.exercise = ?"
            args += (exercise,)
        return self._load_sets((where, args))

    def summary(self, athlete_id: str, session_id: str) -> SessionSummary:
        session = self.get_session(athlete_id, session_id)
        sets = self._load_sets(("s.session_id = ?", (session_id,)))
        volume: dict[str, float] = {}
        for s in sets:  # never add kg to lb
            volume[s.unit] = volume.get(s.unit, 0) + s.weight * s.reps
        return SessionSummary(
            **session.model_dump(),
            sets=sets,
            total_reps=sum(s.reps for s in sets),
            volume=volume,
        )

    # athletes + leaderboard ---------------------------------------------------

    def get_athlete(self, athlete_id: str) -> AthleteOut:
        with self.tx() as conn:
            row = conn.execute("SELECT * FROM athletes WHERE id = ?", (athlete_id,)).fetchone()
        if row is None:
            return AthleteOut(id=athlete_id, display_name=None, leaderboard_opt_in=False)
        return AthleteOut(
            id=row["id"],
            display_name=row["display_name"],
            leaderboard_opt_in=bool(row["leaderboard_opt_in"]),
        )

    def update_athlete(self, athlete_id: str, body: AthleteIn, demo: bool = False) -> AthleteOut:
        with self.tx() as conn:
            conn.execute(
                "INSERT INTO athletes (id, created_at, display_name, leaderboard_opt_in, demo) "
                "VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET "
                "display_name = excluded.display_name, "
                "leaderboard_opt_in = excluded.leaderboard_opt_in",
                (athlete_id, now_iso(), body.display_name, int(body.leaderboard_opt_in), int(demo)),
            )
        return self.get_athlete(athlete_id)

    def weekly_stats(self, start: datetime, end: datetime) -> list[tuple[str, bool, int, int]]:
        """(display_name, demo, reps, sessions) for opted-in athletes in [start, end)."""
        with self.tx() as conn:
            rows = conn.execute(
                "SELECT a.display_name AS name, a.demo AS demo, "
                "COALESCE(SUM(s.reps), 0) AS reps, COUNT(DISTINCT s.session_id) AS sessions "
                "FROM athletes a JOIN sessions se ON se.athlete_id = a.id "
                "JOIN sets s ON s.session_id = se.id "
                "WHERE a.leaderboard_opt_in = 1 AND a.display_name IS NOT NULL "
                "AND s.completed_at >= ? AND s.completed_at < ? GROUP BY a.id",
                (start.isoformat(), end.isoformat()),
            ).fetchall()
        return [(r["name"], bool(r["demo"]), r["reps"], r["sessions"]) for r in rows]

    # diagnostics ----------------------------------------------------------------

    def counts(self) -> dict[str, int]:
        with self.tx() as conn:
            return {
                t: int(conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0])
                for t in ("athletes", "sessions", "sets")
            }

    def size_bytes(self) -> int:
        files = [self.path, self.path.with_name(self.path.name + "-wal")]
        return sum(f.stat().st_size for f in files if f.exists())
