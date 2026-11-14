"""The committed OpenAPI contract (docs/openapi.json) must match the running API.

Regenerate after an intentional API change:  python scripts/export_openapi.py
"""

import json
from pathlib import Path

from jimbro.api import create_app

CONTRACT = Path(__file__).resolve().parents[2] / "docs" / "openapi.json"


def test_openapi_contract_is_up_to_date(tmp_path: Path) -> None:
    live = create_app(db_path=tmp_path / "c.db", static_dir=None, model=None).openapi()
    committed = json.loads(CONTRACT.read_text())
    assert committed == live, "API changed: run python scripts/export_openapi.py and commit"
