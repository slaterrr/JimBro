"""v2 schema: versioned migrations, constraints, and upgrades that keep existing Pi data."""

import sqlite3

import pytest
from backend.jimbro.db import Database
from backend.jimbro.schemas import SessionIn  # noqa: F401  (legacy schema still importable)
from backend.jimbro.v2.store import MIGRATIONS, Store


def test_fresh_database_gets_every_migration_once(tmp_path):
    s = Store(tmp_path / "a.db")
    assert s.applied_versions() == [m[0] for m in MIGRATIONS]
    Store(tmp_path / "a.db")  # re-open: nothing re-applied, no error
    assert s.applied_versions() == [m[0] for m in MIGRATIONS]


def test_upgrading_a_legacy_pi_database_keeps_its_data(tmp_path):
    path = tmp_path / "pi.db"
    legacy = Database(path)
    sess = legacy.create_session("me", "old")
    Store(path)
    assert legacy.get_session("me", sess.id).notes == "old"


def test_core_tables_and_indexes_exist(tmp_path):
    s = Store(tmp_path / "a.db")
    with s.tx() as c:
        tables = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        indexes = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='index'")}
    for t in [
        "users",
        "auth_tokens",
        "password_resets",
        "profiles",
        "goals",
        "plans",
        "scheduled_workouts",
        "workouts",
        "workout_sets",
        "set_reps",
        "vision_events",
        "recommendations",
        "ai_proposals",
        "substitutions",
        "idempotency_keys",
        "ai_usage",
    ]:
        assert t in tables, t
    assert "workout_sets_user_exercise" in indexes
    assert "vision_events_workout" in indexes


def test_constraints_reject_bad_rows(tmp_path):
    s = Store(tmp_path / "a.db")
    with s.tx() as c:
        c.execute(
            "INSERT INTO users (id, email, password_hash, created_at) VALUES ('u1', 'a@b.co', 'x', 't')"
        )
        with pytest.raises(sqlite3.IntegrityError):
            c.execute(
                "INSERT INTO users (id, email, password_hash, created_at) VALUES ('u2', 'A@B.CO', 'x', 't')"
            )
        c.execute(
            "INSERT INTO workouts (id, user_id, name, started_at, status, version) "
            "VALUES ('w1', 'u1', 'W', 't', 'active', 1)"
        )
        for bad in [
            "('s1', 'w1', 'u1', 'curl', 20, 'stone', 8, NULL, NULL, 'manual', 't', 'h')",
            "('s2', 'w1', 'u1', 'curl', 20, 'lb', -1, NULL, NULL, 'manual', 't', 'h')",
            "('s3', 'w1', 'u1', 'curl', 20, 'lb', 8, 11, NULL, 'manual', 't', 'h')",
            "('s4', 'w1', 'u1', 'curl', 20, 'lb', 8, NULL, -1, 'manual', 't', 'h')",
            "('s5', 'w1', 'u1', 'curl', -5, 'lb', 8, NULL, NULL, 'manual', 't', 'h')",
        ]:
            with pytest.raises(sqlite3.IntegrityError):
                c.execute(
                    "INSERT INTO workout_sets (id, workout_id, user_id, exercise, weight, unit, reps, "
                    f"rpe, rir, source, completed_at, payload_hash) VALUES {bad}"
                )


def test_foreign_keys_enforced(tmp_path):
    s = Store(tmp_path / "a.db")
    with s.tx() as c, pytest.raises(sqlite3.IntegrityError):
        c.execute(
            "INSERT INTO workouts (id, user_id, name, started_at, status, version) "
            "VALUES ('w1', 'nobody', 'W', 't', 'active', 1)"
        )
