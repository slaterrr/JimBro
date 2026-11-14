"""Shared fixtures: every test gets an isolated on-disk SQLite database."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from jimbro.api import create_app


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "jimbro.db"


@pytest.fixture
def client(db_path: Path) -> Iterator[TestClient]:
    with TestClient(create_app(db_path=db_path)) as c:
        yield c
