"""The Pi serves the built PWA so phones only need the Pi's address."""

from pathlib import Path

from fastapi.testclient import TestClient

from jimbro.api import create_app


def test_serves_pwa_with_spa_fallback_without_shadowing_api(tmp_path: Path) -> None:
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html>JimBro</html>")
    (dist / "app.js").write_text("console.log(1)")
    with TestClient(create_app(db_path=tmp_path / "x.db", static_dir=dist)) as c:
        assert "JimBro" in c.get("/").text
        assert c.get("/app.js").text == "console.log(1)"
        assert "JimBro" in c.get("/history").text  # client-side route
        assert c.get("/health").json() == {"status": "ok"}
        assert c.get("/v1/nope").status_code == 404


def test_missing_static_dir_is_ignored(tmp_path: Path) -> None:
    with TestClient(create_app(db_path=tmp_path / "x.db", static_dir=tmp_path / "none")) as c:
        assert c.get("/").status_code == 404
