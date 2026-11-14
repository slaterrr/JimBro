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
