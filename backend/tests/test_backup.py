"""Consistent online backups with rotation, safe while the API is running."""

import sqlite3
from pathlib import Path

import pytest
from backend.jimbro.backup import backup, list_backups, restore
from backend.jimbro.db import Database
from backend.jimbro.schemas import SetIn


def seeded(path: Path, reps: int = 5) -> Database:
    db = Database(path)
    sid = db.create_session("alex", None).id
    db.complete_set(
        "alex",
        f"s{reps}",
        SetIn(session_id=sid, exercise="curl", weight=10, unit="kg", reps=reps),
    )
    return db


def test_backup_is_a_complete_consistent_copy(tmp_path: Path) -> None:
    db = seeded(tmp_path / "live.db")
    out = backup(db.path, tmp_path / "backups", stamp="20261114T100000")
    assert out.name == "jimbro-20261114T100000.db"
    conn = sqlite3.connect(out)
    assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert conn.execute("SELECT reps FROM sets").fetchone()[0] == 5
    conn.close()


def test_rotation_keeps_newest(tmp_path: Path) -> None:
    db = seeded(tmp_path / "live.db")
    for i in range(5):
        backup(db.path, tmp_path / "b", stamp=f"2026111{i}T000000", keep=3)
    names = [p.name for p in list_backups(tmp_path / "b")]
    assert names == [
        "jimbro-20261114T000000.db",
        "jimbro-20261113T000000.db",
        "jimbro-20261112T000000.db",
    ]


def test_rotation_ignores_unrelated_files(tmp_path: Path) -> None:
    db = seeded(tmp_path / "live.db")
    (tmp_path / "b").mkdir()
    (tmp_path / "b" / "notes.txt").write_text("keep me")
    backup(db.path, tmp_path / "b", stamp="20261114T000000", keep=1)
    assert (tmp_path / "b" / "notes.txt").exists()


def test_missing_source_raises(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        backup(tmp_path / "nope.db", tmp_path / "b")


def test_restore_replaces_live_db_and_keeps_safety_copy(tmp_path: Path) -> None:
    live = tmp_path / "live.db"
    seeded(live, reps=5)
    snap = backup(live, tmp_path / "b", stamp="20261114T000000")
    seeded(live, reps=9)  # newer data after the snapshot
    safety = restore(snap, live)
    conn = sqlite3.connect(live)
    assert [r[0] for r in conn.execute("SELECT reps FROM sets")] == [5]
    conn.close()
    assert safety.exists() and safety != live


def test_restore_rejects_corrupt_file(tmp_path: Path) -> None:
    live = tmp_path / "live.db"
    seeded(live)
    bad = tmp_path / "bad.db"
    bad.write_bytes(b"not a database")
    with pytest.raises(ValueError):
        restore(bad, live)
    conn = sqlite3.connect(live)
    assert conn.execute("SELECT COUNT(*) FROM sets").fetchone()[0] == 1
    conn.close()
