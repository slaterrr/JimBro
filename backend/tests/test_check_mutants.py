"""The mutation gate must fail on mutmut 3's per-mutant result lines (it used to pass)."""

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "check_mutants.py"


@pytest.fixture
def gate() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_mutants", SCRIPT)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_survivor_lines_fail(gate: ModuleType) -> None:
    report = (
        "    backend.jimbro.motion.x_joint_angle__mutmut_42: survived\n"
        "    backend.jimbro.reps.xǁRepCounterǁupdate__mutmut_7: survived\n"
    )
    bad = gate.problems(report)
    assert len(bad) == 2 and "motion" in bad[0]


@pytest.mark.parametrize("status", ["no tests", "suspicious", "timeout", "segfault", "not checked"])
def test_other_bad_statuses_fail(gate: ModuleType, status: str) -> None:
    assert gate.problems(f"    backend.jimbro.reps.x__mutmut_1: {status}\n")


def test_killed_only_report_passes(gate: ModuleType) -> None:
    # `mutmut results` lists only non-killed mutants, so a clean run prints nothing.
    assert gate.problems("") == []
    assert gate.problems("    backend.jimbro.reps.x__mutmut_1: killed\n") == []


def test_unparseable_lines_fail_closed(gate: ModuleType) -> None:
    assert gate.problems("Traceback (most recent call last):\n  boom\n")
