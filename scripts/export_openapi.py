#!/usr/bin/env python3
"""Write the API contract to docs/openapi.json for the frontend team (and type generators).

    python scripts/export_openapi.py
"""

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from jimbro.api import create_app  # noqa: E402

with tempfile.TemporaryDirectory() as tmp:
    spec = create_app(db_path=Path(tmp) / "x.db", static_dir=None, model=None).openapi()
out = ROOT / "docs" / "openapi.json"
out.write_bytes((json.dumps(spec, indent=2, sort_keys=True) + "\n").encode())
print(f"wrote {out} ({len(spec['paths'])} paths)")
