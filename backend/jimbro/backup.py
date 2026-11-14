"""Online SQLite backups (safe while the API runs) with rotation, plus checked restore.

python -m jimbro.backup backup  <db> <dest-dir> [--keep 14]
python -m jimbro.backup restore <snapshot.db> <db>
"""

from __future__ import annotations

import sqlite3
import sys
from datetime import UTC, datetime
from pathlib import Path

PREFIX = "jimbro-"


def _stamp() -> str:
    return datetime.now(UTC).strftime("%Y%m%dT%H%M%S")


def _copy(src: Path, dst: Path) -> None:
    """sqlite3 backup API: a transactionally consistent copy even with WAL writers."""
    with sqlite3.connect(src) as s, sqlite3.connect(dst) as d:
        s.backup(d)
    d.close()
    s.close()


def list_backups(dest: Path) -> list[Path]:
    """Snapshots in dest, newest first (timestamps sort lexically)."""
    if not dest.is_dir():
        return []
    return sorted(dest.glob(f"{PREFIX}*.db"), reverse=True)


def backup(db: Path, dest: Path, stamp: str | None = None, keep: int = 14) -> Path:
    if not db.is_file():
        raise FileNotFoundError(db)
    dest.mkdir(parents=True, exist_ok=True)
    out = dest / f"{PREFIX}{stamp or _stamp()}.db"
    tmp = out.with_suffix(".partial")
    tmp.unlink(missing_ok=True)
    _copy(db, tmp)
    tmp.replace(out)  # never leave a half-written snapshot behind
    for old in list_backups(dest)[keep:]:
        old.unlink()
    return out


def _check(path: Path) -> None:
    try:
        with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as conn:
            ok = conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
            tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master")}
        conn.close()
    except sqlite3.DatabaseError as e:
        raise ValueError(f"{path} is not a JimBro database: {e}") from e
    if not ok or not {"sessions", "sets"} <= tables:
        raise ValueError(f"{path} is not a valid JimBro database")


def restore(snapshot: Path, db: Path) -> Path:
    """Replace db with snapshot after validating it; returns a safety copy of the old db."""
    _check(snapshot)
    safety = backup(db, db.parent / "pre-restore", keep=5) if db.is_file() else db
    _copy(snapshot, db)
    return safety


def main(argv: list[str]) -> int:  # pragma: no cover - CLI wrapper
    if len(argv) >= 3 and argv[0] == "backup":
        keep = int(argv[argv.index("--keep") + 1]) if "--keep" in argv else 14
        print(backup(Path(argv[1]), Path(argv[2]), keep=keep))
        return 0
    if len(argv) == 3 and argv[0] == "restore":
        print(f"restored; previous data saved at {restore(Path(argv[1]), Path(argv[2]))}")
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main(sys.argv[1:]))
