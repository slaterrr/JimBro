"""Contract tests for pose geometry; write failing cases before changes."""

import math

import pytest
from backend.jimbro.motion import joint_angle


@pytest.mark.parametrize(
    ("a", "joint", "c", "expected"),
    [
        ((1.0, 0.0), (0.0, 0.0), (0.0, 1.0), 90.0),
        ((1.0, 0.0), (0.0, 0.0), (2.0, 0.0), 0.0),
        ((-1.0, 0.0), (0.0, 0.0), (1.0, 0.0), 180.0),
        ((2.0, 1.0), (1.0, 1.0), (1.0, 3.0), 90.0),
    ],
)
def test_joint_angle(
    a: tuple[float, float],
    joint: tuple[float, float],
    c: tuple[float, float],
    expected: float,
) -> None:
    assert joint_angle(a, joint, c) == pytest.approx(expected)


@pytest.mark.parametrize("coordinate", [math.nan, math.inf, -math.inf])
def test_non_finite_landmark_rejected(coordinate: float) -> None:
    with pytest.raises(ValueError, match="finite"):
        joint_angle((coordinate, 0.0), (0.0, 0.0), (1.0, 1.0))


@pytest.mark.parametrize(
    ("a", "joint", "c"),
    [
        ((0.0, 0.0), (0.0, 0.0), (1.0, 0.0)),
        ((1.0, 0.0), (0.0, 0.0), (0.0, 0.0)),
    ],
)
def test_overlapping_landmarks_rejected(
    a: tuple[float, float],
    joint: tuple[float, float],
    c: tuple[float, float],
) -> None:
    with pytest.raises(ValueError, match="overlap"):
        joint_angle(a, joint, c)


# --- mutation-hardening: asymmetric geometry, an independent oracle, rounding clamps ----

from math import atan2, degrees  # noqa: E402


def oracle(a: tuple[float, float], j: tuple[float, float], c: tuple[float, float]) -> float:
    """Independent formula (atan2 of cross and dot), not the acos used in production."""
    ax, ay, cx, cy = a[0] - j[0], a[1] - j[1], c[0] - j[0], c[1] - j[1]
    return abs(degrees(atan2(ax * cy - ay * cx, ax * cx + ay * cy)))


@pytest.mark.parametrize(
    ("a", "joint", "c"),
    [
        ((4.0, 1.0), (1.0, 2.0), (2.0, 7.0)),
        ((0.3, 0.9), (0.5, 0.4), (0.9, 0.45)),
        ((-3.0, 5.0), (2.0, -1.0), (7.0, 4.0)),
        ((10.0, 0.0), (0.0, 0.0), (0.0, 30.0)),  # arms of very different length
    ],
)
def test_asymmetric_points_match_independent_oracle(
    a: tuple[float, float], joint: tuple[float, float], c: tuple[float, float]
) -> None:
    assert joint_angle(a, joint, c) == pytest.approx(oracle(a, joint, c), abs=1e-9)


X, Y, K = -2.449309742605783, -0.04564912908059071, 3.2014883470422935


def test_rounding_past_minus_one_is_clamped_to_180() -> None:
    # This geometry makes the raw cosine -1.0000000000000002 in IEEE floats.
    assert joint_angle((X, Y), (0.0, 0.0), (-K * X, -K * Y)) == pytest.approx(180.0)


def test_rounding_past_plus_one_is_clamped_to_0() -> None:
    assert joint_angle((X, Y), (0.0, 0.0), (K * X, K * Y)) == pytest.approx(0.0, abs=1e-6)


def test_error_messages_are_specific() -> None:
    with pytest.raises(ValueError, match="^landmark coordinates must be finite$"):
        joint_angle((math.inf, 0.0), (0.0, 0.0), (1.0, 1.0))
    with pytest.raises(ValueError, match="^landmarks must not overlap at the joint$"):
        joint_angle((1.0, 1.0), (1.0, 1.0), (2.0, 2.0))
