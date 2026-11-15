"""v2 persistence: versioned migrations on the same SQLite file as the Pi API (stdlib only).

Migrations are tracked in schema_migrations, so existing Pi databases upgrade in place and keep
their data. Every write runs in one transaction (see Store.tx).
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

V1 = """
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS auth_tokens_user ON auth_tokens(user_id);
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  fitness_goal TEXT,
  experience TEXT,
  unit TEXT NOT NULL DEFAULT 'lb' CHECK (unit IN ('kg', 'lb')),
  equipment TEXT NOT NULL DEFAULT '[]',
  avoid TEXT NOT NULL DEFAULT '[]',
  preferences TEXT NOT NULL DEFAULT '{}',
  height_cm REAL CHECK (height_cm IS NULL OR height_cm > 0),
  weight_kg REAL CHECK (weight_kg IS NULL OR weight_kg > 0),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  exercise TEXT,
  target TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done', 'dropped')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  goal TEXT,
  days TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('user', 'ai')),
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scheduled_workouts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
  day_index INTEGER,
  scheduled_for TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done', 'skipped'))
);
CREATE TABLE IF NOT EXISTS workouts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'abandoned')),
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS workouts_user ON workouts(user_id, started_at);
CREATE TABLE IF NOT EXISTS workout_sets (
  id TEXT PRIMARY KEY,
  workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise TEXT NOT NULL,
  weight REAL NOT NULL CHECK (weight >= 0),
  unit TEXT NOT NULL CHECK (unit IN ('kg', 'lb')),
  reps INTEGER NOT NULL CHECK (reps >= 0),
  target INTEGER CHECK (target IS NULL OR target >= 0),
  rpe REAL CHECK (rpe IS NULL OR (rpe >= 1 AND rpe <= 10)),
  rir REAL CHECK (rir IS NULL OR (rir >= 0 AND rir <= 10)),
  source TEXT NOT NULL CHECK (source IN ('camera', 'manual', 'voice', 'ai')),
  completed_at TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  metrics TEXT,
  fatigue TEXT
);
CREATE INDEX IF NOT EXISTS workout_sets_workout ON workout_sets(workout_id, completed_at);
CREATE INDEX IF NOT EXISTS workout_sets_user_exercise
  ON workout_sets(user_id, exercise, completed_at);
CREATE TABLE IF NOT EXISTS set_reps (
  set_id TEXT NOT NULL REFERENCES workout_sets(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  concentric_ms INTEGER, peak_pause_ms INTEGER, eccentric_ms INTEGER,
  rom_deg REAL, peak_dps REAL, mean_dps REAL, variant TEXT, lead TEXT,
  PRIMARY KEY (set_id, idx)
);
CREATE TABLE IF NOT EXISTS vision_events (
  event_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  schema_version TEXT NOT NULL,
  type TEXT NOT NULL,
  exercise_id TEXT,
  ts REAL NOT NULL,
  source TEXT NOT NULL,
  confidence REAL,
  validation TEXT NOT NULL,
  units TEXT NOT NULL,
  data TEXT NOT NULL,
  received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS vision_events_workout ON vision_events(workout_id, ts);
CREATE TABLE IF NOT EXISTS recommendations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_id TEXT REFERENCES workouts(id) ON DELETE SET NULL,
  exercise TEXT,
  action TEXT NOT NULL CHECK (action IN
    ('increase', 'same', 'decrease', 'more_rest', 'fewer_reps', 'none')),
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS recommendations_user ON recommendations(user_id, status, created_at);
CREATE TABLE IF NOT EXISTS ai_proposals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('log', 'correct', 'delete', 'plan')),
  payload TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'rejected', 'expired')),
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE TABLE IF NOT EXISTS substitutions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_id TEXT REFERENCES workouts(id) ON DELETE SET NULL,
  from_exercise TEXT NOT NULL,
  to_exercise TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
CREATE TABLE IF NOT EXISTS ai_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
"""

# (version, name, sql). Append only; never edit an applied migration.
V2 = """
CREATE TABLE IF NOT EXISTS user_sync_state (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
"""

MIGRATIONS: list[tuple[int, str, str]] = [(1, "v2 core schema", V1), (2, "per-user sync snapshots", V2)]


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds")


class Store:
    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.tx() as c:
            c.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations "
                "(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)"
            )
            done = {r[0] for r in c.execute("SELECT version FROM schema_migrations")}
            for version, name, sql in MIGRATIONS:
                if version in done:
                    continue
                c.executescript(sql)
                c.execute(
                    "INSERT INTO schema_migrations VALUES (?, ?, ?)", (version, name, now_iso())
                )

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        try:
            yield conn
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            conn.close()

    def applied_versions(self) -> list[int]:
        with self.tx() as c:
            return [
                r[0] for r in c.execute("SELECT version FROM schema_migrations ORDER BY version")
            ]
