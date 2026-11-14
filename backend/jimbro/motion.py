"""Pure, deterministic geometry utilities for exercise pose landmarks."""

from math import acos, degrees, hypot, isfinite

Point = tuple[float, float]


def joint_angle(a: Point, joint: Point, c: Point) -> float:
    """Return angle a–joint–c in degrees, in [0, 180].

    Raises ValueError when a point is non-finite or either arm has zero length.
    No camera or model dependencies: this remains independently testable.
    """
    points = (*a, *joint, *c)
    if not all(isfinite(value) for value in points):
        raise ValueError("landmark coordinates must be finite")

    ax, ay = a[0] - joint[0], a[1] - joint[1]
    cx, cy = c[0] - joint[0], c[1] - joint[1]
    length_a = hypot(ax, ay)
    length_c = hypot(cx, cy)
    if length_a == 0 or length_c == 0:
        raise ValueError("landmarks must not overlap at the joint")

    cosine = (ax * cx + ay * cy) / (length_a * length_c)
    cosine = max(-1.0, min(1.0, cosine))
    return degrees(acos(cosine))
