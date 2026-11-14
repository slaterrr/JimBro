"""Contract tests for the rep/phase state machine using timestamped angle fixtures."""

from collections.abc import Iterable, Sequence

import pytest
from backend.jimbro.reps import (
    CURL,
    MOVEMENTS,
    SHOULDER_PRESS,
    SQUAT,
    AngleSample,
    MovementConfig,
    RepCounter,
    RepSummary,
)

DT = 33  # ~30 fps


def ramp(start: float, end: float, ms: int, t0: int) -> list[tuple[int, float]]:
    steps = max(1, ms // DT)
    return [(t0 + i * DT, start + (end - start) * i / steps) for i in range(1, steps + 1)]


def hold(angle: float, ms: int, t0: int) -> list[tuple[int, float]]:
    return [(t0 + i * DT, angle) for i in range(1, max(1, ms // DT) + 1)]


def curl_reps(
    n: int,
    *,
    up_ms: int = 800,
    top_ms: int = 200,
    down_ms: int = 1200,
    rest_ms: int = 400,
    low: float = 170,
    high: float = 40,
) -> list[tuple[int, float]]:
    out: list[tuple[int, float]] = [(0, low)]
    for _ in range(n):
        for seg in (
            lambda t: hold(low, rest_ms, t),
            lambda t: ramp(low, high, up_ms, t),
            lambda t: hold(high, top_ms, t),
            lambda t: ramp(high, low, down_ms, t),
        ):
            out += seg(out[-1][0])
    out += hold(low, rest_ms, out[-1][0])
    return out


def feed(
    samples: Iterable[tuple[int, float]],
    config: MovementConfig = CURL,
    confidence: float = 0.9,
) -> tuple[RepCounter, list[RepSummary]]:
    counter = RepCounter(config)
    reps: list[RepSummary] = []
    for t, angle in samples:
        rep = counter.update(AngleSample(t_ms=t, angle_deg=angle, confidence=confidence))
        if rep:
            reps.append(rep)
    return counter, reps


def test_stationary_arm_counts_zero() -> None:
    counter, reps = feed(hold(170, 5000, 0))
    assert reps == [] and counter.count == 0 and counter.partials == 0


def test_five_full_curls_count_five_with_indices() -> None:
    counter, reps = feed(curl_reps(5))
    assert counter.count == 5
    assert [r.index for r in reps] == [1, 2, 3, 4, 5]


def test_phase_timing_matches_fixture_within_one_frame_window() -> None:
    _, reps = feed(curl_reps(1, up_ms=900, top_ms=300, down_ms=1500))
    rep = reps[0]
    # Thresholds sit inside the ramps, so measured phases are a bit shorter than the ramp.
    assert 450 <= rep.concentric_ms <= 900
    assert 300 <= rep.peak_pause_ms <= 950
    assert 800 <= rep.eccentric_ms <= 1500
    assert rep.tut_ms == rep.concentric_ms + rep.peak_pause_ms + rep.eccentric_ms
    assert rep.eccentric_ms > rep.concentric_ms
    assert rep.end_ms > rep.start_ms
    assert rep.end_ms - rep.start_ms == rep.tut_ms


def test_three_partials_are_not_counted_but_are_reported() -> None:
    counter, reps = feed(curl_reps(3, high=110))
    assert reps == [] and counter.count == 0 and counter.partials == 3


def test_noisy_jitter_near_threshold_does_not_double_count() -> None:
    samples = curl_reps(2)
    noisy = [(t, a + (6 if i % 2 else -6)) for i, (t, a) in enumerate(samples)]
    counter, _ = feed(noisy)
    assert counter.count == 2


def test_too_fast_bounce_is_rejected() -> None:
    counter, _ = feed(curl_reps(1, up_ms=100, top_ms=0, down_ms=100))
    assert counter.count == 0
    assert counter.partials == 1


def test_slow_rep_counts_once_with_long_tut() -> None:
    counter, reps = feed(curl_reps(1, up_ms=4000, top_ms=1000, down_ms=5000))
    assert counter.count == 1
    assert reps[0].tut_ms > 7000


def test_occlusion_mid_rep_aborts_rep() -> None:
    samples = curl_reps(1)
    mid = len(samples) // 2
    counter = RepCounter(CURL)
    for t, a in samples[:mid]:
        counter.update(AngleSample(t, a, 0.9))
    # 1.5 s of low confidence data, then the arm is back at rest.
    t_occ = samples[mid][0]
    for t, a in hold(90, 1500, t_occ):
        assert counter.update(AngleSample(t, a, 0.1)) is None
    for t, a in hold(170, 600, t_occ + 1500):
        counter.update(AngleSample(t, a, 0.9))
    assert counter.count == 0
    assert counter.state == "rest"


def test_brief_dropout_does_not_abort_rep() -> None:
    samples = curl_reps(1)
    counter = RepCounter(CURL)
    reps = []
    for i, (t, a) in enumerate(samples):
        conf = 0.1 if 40 <= i < 44 else 0.9
        rep = counter.update(AngleSample(t, a, conf))
        if rep:
            reps.append(rep)
    assert counter.count == 1


def test_out_of_order_and_nonfinite_samples_are_ignored() -> None:
    counter = RepCounter(CURL)
    assert counter.update(AngleSample(1000, 170, 0.9)) is None
    assert counter.update(AngleSample(900, 40, 0.9)) is None
    assert counter.update(AngleSample(1100, float("nan"), 0.9)) is None
    assert counter.state == "rest"


def test_cooldown_blocks_immediate_retrigger() -> None:
    counter, _ = feed(curl_reps(2, rest_ms=0))
    assert counter.count >= 1
    assert counter.count <= 2


def test_start_mid_rep_requires_rest_first() -> None:
    samples = ramp(60, 40, 300, 0) + ramp(40, 170, 1200, 300) + hold(170, 300, 1500)
    counter, _ = feed(samples)
    assert counter.count == 0


def test_increasing_movement_shoulder_press() -> None:
    counter, _ = feed(curl_reps(3, low=80, high=168), SHOULDER_PRESS)
    assert counter.count == 3


def test_squat_config_counts_knee_flexion() -> None:
    counter, _ = feed(curl_reps(2, low=172, high=85), SQUAT)
    assert counter.count == 2


def test_reset_clears_everything() -> None:
    counter, _ = feed(curl_reps(2))
    counter.reset()
    assert (counter.count, counter.partials, counter.state) == (0, 0, "rest")


def test_movement_registry() -> None:
    assert set(MOVEMENTS) == {"curl", "squat", "shoulder_press"}


@pytest.mark.parametrize(
    "kwargs",
    [
        {"rest_deg": 100, "peak_deg": 100},
        {"rest_deg": 170, "peak_deg": 40, "hysteresis_deg": -1},
        {"rest_deg": 170, "peak_deg": 40, "smoothing": 0},
        {"rest_deg": 170, "peak_deg": 40, "smoothing": 1.5},
        {"rest_deg": 170, "peak_deg": 40, "min_confidence": 2},
        {"rest_deg": 170, "peak_deg": 40, "hysteresis_deg": 80},
    ],
)
def test_invalid_config_rejected(kwargs: dict[str, float]) -> None:
    with pytest.raises(ValueError):
        MovementConfig(name="bad", **kwargs)


def summarize(reps: Sequence[RepSummary]) -> list[int]:
    return [r.tut_ms for r in reps]


def test_reps_are_deterministic() -> None:
    assert summarize(feed(curl_reps(3))[1]) == summarize(feed(curl_reps(3))[1])
