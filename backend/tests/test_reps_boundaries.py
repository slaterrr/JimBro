"""Exact-threshold contract for the rep state machine (written to kill surviving mutants).

With smoothing=1 (none) and hysteresis 10 on a 170 -> 50 degree movement, depth = 170 - angle
and the thresholds are: arm/rest-enter <= 10, leave rest > 20, peak >= 110, leave peak < 100.
"""

import pytest
from backend.jimbro.reps import CURL, SHOULDER_PRESS, AngleSample, MovementConfig, RepCounter


def cfg(**over: float) -> MovementConfig:
    base: dict[str, float] = {
        "rest_deg": 170,
        "peak_deg": 50,
        "hysteresis_deg": 10,
        "smoothing": 1.0,
        "min_rep_ms": 0,
        "cooldown_ms": 0,
    }
    base.update(over)
    return MovementConfig(name="t", **base)  # type: ignore[arg-type]


def run(counter: RepCounter, steps: list[tuple[int, float]], conf: float = 0.9) -> RepCounter:
    for t, depth in steps:
        counter.update(AngleSample(t_ms=t, angle_deg=170 - depth, confidence=conf))
    return counter


def fresh(**over: float) -> RepCounter:
    return RepCounter(cfg(**over))


FULL_REP = [(0, 0.0), (100, 50.0), (200, 115.0), (300, 50.0), (400, 0.0)]


# --- thresholds ----------------------------------------------------------------


def test_arming_is_inclusive_at_rest_enter() -> None:
    assert run(fresh(), [(0, 10.0), (100, 21.0)]).state == "concentric"


def test_leaving_rest_is_strictly_above_rest_exit() -> None:
    assert run(fresh(), [(0, 0.0), (100, 20.0)]).state == "rest"
    assert run(fresh(), [(0, 0.0), (100, 20.5)]).state == "concentric"


def test_peak_is_inclusive_at_peak_enter() -> None:
    assert run(fresh(), [(0, 0.0), (100, 50.0), (200, 110.0)]).state == "peak"


def test_leaving_peak_is_strictly_below_peak_exit() -> None:
    base = [(0, 0.0), (100, 50.0), (200, 115.0)]
    assert run(fresh(), [*base, (300, 100.0)]).state == "peak"
    assert run(fresh(), [*base, (300, 99.5)]).state == "eccentric"


def test_eccentric_can_return_to_peak_inclusively() -> None:
    c = run(fresh(), [(0, 0.0), (100, 50.0), (200, 115.0), (300, 60.0), (400, 110.0)])
    assert c.state == "peak"


def test_rep_completes_inclusively_at_rest_enter() -> None:
    c = run(fresh(), [(0, 0.0), (100, 50.0), (200, 115.0), (300, 50.0), (400, 10.0)])
    assert (c.count, c.state) == (1, "rest")


def test_partial_completes_inclusively_at_rest_enter() -> None:
    c = run(fresh(), [(0, 0.0), (100, 50.0), (200, 10.0)])
    assert (c.count, c.partials, c.state) == (0, 1, "rest")


# --- timing rules ----------------------------------------------------------------


def test_rep_lasting_exactly_min_rep_ms_counts() -> None:
    c = run(fresh(min_rep_ms=1000), [(0, 0.0), (100, 50.0), (500, 115.0), (900, 50.0), (1100, 0.0)])
    assert c.count == 1  # started at 100, ended at 1100: exactly 1000 ms


def test_cooldown_allows_leaving_rest_exactly_when_it_ends() -> None:
    c = run(fresh(cooldown_ms=300), FULL_REP)  # rep ends at t=400
    assert run(c, [(700, 50.0)]).state == "concentric"


def test_cooldown_blocks_leaving_rest_just_before_it_ends() -> None:
    c = run(fresh(cooldown_ms=300), FULL_REP)
    assert run(c, [(699, 50.0)]).state == "rest"


def test_gap_of_exactly_max_gap_does_not_abort() -> None:
    c = run(
        fresh(max_gap_ms=1000), [(0, 0.0), (100, 50.0), (1100, 115.0), (1200, 50.0), (1300, 0.0)]
    )
    assert c.count == 1


def test_duplicate_timestamp_is_ignored() -> None:
    assert run(fresh(), [(0, 0.0), (100, 50.0), (100, 0.0)]).state == "concentric"


# --- inputs -------------------------------------------------------------------------


def test_confidence_exactly_at_minimum_is_accepted() -> None:
    assert run(fresh(min_confidence=0.5), FULL_REP, conf=0.5).count == 1


def test_nan_confidence_with_finite_angle_is_ignored() -> None:
    c = run(fresh(), [(0, 0.0)])
    c.update(AngleSample(t_ms=100, angle_deg=120, confidence=float("nan")))
    assert c.state == "rest"


def test_smoothing_suppresses_a_single_frame_spike() -> None:
    # alpha 0.25: one raw depth-70 frame smooths to 17.5, below the leave-rest threshold.
    assert run(fresh(smoothing=0.25), [(0, 0.0), (100, 70.0)]).state == "rest"
    assert run(fresh(smoothing=1.0), [(0, 0.0), (100, 70.0)]).state == "concentric"


# --- reset ------------------------------------------------------------------------


def test_reset_behaves_like_a_new_counter() -> None:
    c = run(fresh(cooldown_ms=10_000), FULL_REP)
    c.reset()
    # earlier timestamps are accepted again, cooldown is cleared, and arming is required
    assert run(c, [(-50, 50.0)]).state == "rest"
    run(c, [(-40, 0.0), (0, 50.0), (100, 115.0), (200, 50.0), (300, 0.0)])
    assert (c.count, c.partials) == (1, 0)


def test_reset_clears_the_good_sample_clock() -> None:
    c = run(fresh(max_gap_ms=100), [(5000, 0.0)])
    c.reset()
    assert run(c, FULL_REP).count == 1


# --- depth direction ----------------------------------------------------------------


def test_depth_for_flexion_and_extension() -> None:
    assert CURL.depth(155) == pytest.approx(10.0)
    assert SHOULDER_PRESS.depth(100) == pytest.approx(15.0)  # rest 85 -> peak 160


# --- config validation ----------------------------------------------------------------


@pytest.mark.parametrize(
    "over",
    [
        {"rest_deg": 100, "peak_deg": 100.5, "hysteresis_deg": 0.1},  # tiny but non-zero span
        {"hysteresis_deg": 0},
        {"rest_deg": 170, "peak_deg": 130, "hysteresis_deg": 9},  # 4h = 36 < 40
        {"smoothing": 1.0},
        {"smoothing": 0.5},
        {"min_confidence": 0.0},
        {"min_confidence": 1.0},
    ],
)
def test_valid_boundary_configs(over: dict[str, float]) -> None:
    cfg(**over)


@pytest.mark.parametrize(
    ("over", "message"),
    [
        (
            {"rest_deg": 100, "peak_deg": 100, "hysteresis_deg": 0},
            "^rest and peak angles must differ$",
        ),
        (
            {"rest_deg": 170, "peak_deg": 130, "hysteresis_deg": 10},
            "^hysteresis must be non-negative",
        ),
        ({"hysteresis_deg": -0.5}, "below a quarter of the span$"),
        ({"smoothing": 0}, r"^smoothing must be in \(0, 1\]$"),
        ({"min_confidence": -0.1}, r"^min_confidence must be in \[0, 1\]$"),
    ],
)
def test_invalid_configs_have_specific_messages(over: dict[str, float], message: str) -> None:
    with pytest.raises(ValueError, match=message):
        cfg(**over)
