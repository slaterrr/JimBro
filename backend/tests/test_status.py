"""Headless diagnostics: one endpoint that says whether the Pi is healthy."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from jimbro.api import create_app


def test_status_reports_health_without_secrets(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-secret-value")
    with TestClient(create_app(db_path=tmp_path / "s.db", model=None)) as c:
        sid = c.post("/v1/sessions", json={}).json()["id"]
        body = {
            "session_id": sid,
            "exercise": "curl",
            "weight": 5,
            "unit": "kg",
            "reps": 3,
            "source": "manual",
            "reps_detail": [],
        }
        c.post("/v1/sets/a/complete", json=body)
        res = c.get("/v1/status")
    assert res.status_code == 200
    data = res.json()
    assert "sk-ant" not in res.text
    assert data["ok"] is True
    assert data["counts"] == {"athletes": 1, "sessions": 1, "sets": 1}
    assert data["db_bytes"] > 0
    assert data["disk_free_bytes"] > 0
    assert data["uptime_s"] >= 0
    assert data["coach"] == "offline"
    assert isinstance(data["version"], str) and data["version"]


def test_status_flags_low_disk(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import shutil

    monkeypatch.setattr(shutil, "disk_usage", lambda _p: shutil._ntuple_diskusage(100, 99, 1))  # type: ignore[attr-defined]
    with TestClient(create_app(db_path=tmp_path / "s.db", model=None)) as c:
        data = c.get("/v1/status").json()
    assert data["ok"] is False and "disk" in " ".join(data["warnings"])
