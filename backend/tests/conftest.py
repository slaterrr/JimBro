"""Resolve the package in the current test checkout, including mutmut isolation."""

from pathlib import Path
import sys

source_root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(source_root))
