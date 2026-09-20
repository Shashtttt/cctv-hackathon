"""
IBVAP — Virtual Fence Geometry Engine (production-grade)
Supports:
  • Point-in-polygon (ray-casting) for zone entry detection
  • Directional breach detection (ENTRY / EXIT)
  • Tripwire crossing (line segment intersection)
  • Loitering area computation
  • Polygon centroid for heatmap analytics
  • NumPy-vectorised batch testing for multi-target frames
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np




Point = Tuple[float, float]           # (x_norm, y_norm) in [0, 1]
Polygon = List[Dict[str, float]]      # [{"x": .., "y": ..}, ...]


class BreachDirection(str, Enum):
    ENTRY = "ENTRY"
    EXIT = "EXIT"
    UNKNOWN = "UNKNOWN"


@dataclass
class BreachResult:
    target_id: str
    is_breaching: bool
    direction: BreachDirection = BreachDirection.UNKNOWN
    dwell_seconds: float = 0.0


@dataclass
class ZoneState:
    """Tracks per-target inside/outside state across frames for direction detection."""
    _was_inside: Dict[str, bool] = field(default_factory=dict)

    def update(self, target_id: str, is_inside: bool) -> BreachDirection:
        """
        Return the direction of state change:
          False → True  →  ENTRY (new breach)
          True  → False →  EXIT  (left zone)
          unchanged     →  UNKNOWN (no transition)
        """
        was = self._was_inside.get(target_id, False)
        self._was_inside[target_id] = is_inside

        if not was and is_inside:
            return BreachDirection.ENTRY
        if was and not is_inside:
            return BreachDirection.EXIT
        return BreachDirection.UNKNOWN

    def reset(self, target_id: Optional[str] = None) -> None:
        if target_id:
            self._was_inside.pop(target_id, None)
        else:
            self._was_inside.clear()

    def is_inside(self, target_id: str) -> bool:
        return self._was_inside.get(target_id, False)




def is_point_in_polygon(point: Dict[str, float], polygon: Polygon) -> bool:
    """
    Ray-casting point-in-polygon test (normalised 0..1 coordinates).
    Handles:
      • Degenerate polygons (< 3 points) → returns False
      • Collinear/on-edge points via separate segment check
      • Division-by-zero via epsilon guard
    """
    if not polygon or len(polygon) < 3:
        return False

    x, y = point["x"], point["y"]

    # Fast reject: bounding-box test
    xs = [p["x"] for p in polygon]
    ys = [p["y"] for p in polygon]
    if x < min(xs) or x > max(xs) or y < min(ys) or y > max(ys):
        return False

    # Check if point lies exactly on any edge
    n = len(polygon)
    for i in range(n):
        j = (i + 1) % n
        if _point_on_segment(
            x, y,
            polygon[i]["x"], polygon[i]["y"],
            polygon[j]["x"], polygon[j]["y"],
        ):
            return True

    # Standard ray-casting
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i]["x"], polygon[i]["y"]
        xj, yj = polygon[j]["x"], polygon[j]["y"]
        dy = yj - yi
        if abs(dy) < 1e-10:
            j = i
            continue
        if (yi > y) != (yj > y):
            intersect_x = (xj - xi) * (y - yi) / dy + xi
            if x < intersect_x:
                inside = not inside
        j = i

    return inside


def _point_on_segment(px: float, py: float,
                       ax: float, ay: float,
                       bx: float, by: float,
                       eps: float = 1e-9) -> bool:
    """Return True if point P lies on segment AB within epsilon tolerance."""
    cross = abs((py - ay) * (bx - ax) - (px - ax) * (by - ay))
    if cross > eps * max(abs(bx - ax), abs(by - ay), 1.0):
        return False
    return (
        min(ax, bx) - eps <= px <= max(ax, bx) + eps
        and min(ay, by) - eps <= py <= max(ay, by) + eps
    )


def batch_points_in_polygon(
    centers: np.ndarray,          # shape (N, 2) — normalised (x, y)
    polygon: Polygon,
) -> np.ndarray:                   # bool array shape (N,)
    """
    NumPy-vectorised polygon test for N targets simultaneously.
    ~100× faster than N serial calls to is_point_in_polygon().
    """
    if not polygon or len(polygon) < 3:
        return np.zeros(len(centers), dtype=bool)

    verts = np.array([[p["x"], p["y"]] for p in polygon], dtype=np.float64)

    # Bounding box fast-reject per point
    xmin, ymin = verts[:, 0].min(), verts[:, 1].min()
    xmax, ymax = verts[:, 0].max(), verts[:, 1].max()
    in_bbox = (
        (centers[:, 0] >= xmin) & (centers[:, 0] <= xmax)
        & (centers[:, 1] >= ymin) & (centers[:, 1] <= ymax)
    )
    result = np.zeros(len(centers), dtype=bool)
    candidates = np.where(in_bbox)[0]
    if len(candidates) == 0:
        return result

    pts = centers[candidates]    # (M, 2)
    n = len(verts)
    inside = np.zeros(len(candidates), dtype=bool)

    j = n - 1
    for i in range(n):
        xi, yi = verts[i]
        xj, yj = verts[j]
        dy = yj - yi
        if abs(dy) < 1e-10:
            j = i
            continue
        cond = (yi > pts[:, 1]) != (yj > pts[:, 1])
        intersect_x = (xj - xi) * (pts[:, 1] - yi) / dy + xi
        toggle = cond & (pts[:, 0] < intersect_x)
        inside ^= toggle
        j = i

    result[candidates] = inside
    return result


def check_tripwire_crossing(
    p1: Point,   # previous position (x_norm, y_norm)
    p2: Point,   # current  position
    line_start: Point,
    line_end: Point,
) -> bool:
    """
    Returns True if the path p1→p2 crosses the line segment line_start→line_end.
    Uses the CCW (counter-clockwise) orientation test.
    """
    def _ccw(A: Point, B: Point, C: Point) -> bool:
        return (C[1] - A[1]) * (B[0] - A[0]) > (B[1] - A[1]) * (C[0] - A[0])

    A, B = line_start, line_end
    C, D = p1, p2
    return _ccw(A, C, D) != _ccw(B, C, D) and _ccw(A, B, C) != _ccw(A, B, D)


def compute_polygon_centroid(polygon: Polygon) -> Optional[Tuple[float, float]]:
    """
    Compute the geometric centroid of a polygon using the shoelace formula.
    Returns (cx, cy) in normalised coordinates, or None for degenerate polygon.
    """
    n = len(polygon)
    if n < 3:
        return None

    area = 0.0
    cx = cy = 0.0
    for i in range(n):
        j = (i + 1) % n
        xi, yi = polygon[i]["x"], polygon[i]["y"]
        xj, yj = polygon[j]["x"], polygon[j]["y"]
        cross = xi * yj - xj * yi
        area += cross
        cx += (xi + xj) * cross
        cy += (yi + yj) * cross

    area /= 2.0
    if abs(area) < 1e-10:
        # Degenerate — fall back to mean of vertices
        xs = [p["x"] for p in polygon]
        ys = [p["y"] for p in polygon]
        return sum(xs) / n, sum(ys) / n

    cx /= (6.0 * area)
    cy /= (6.0 * area)
    return cx, cy


def compute_polygon_area(polygon: Polygon) -> float:
    """
    Signed area of polygon (shoelace formula).
    Returns absolute area in normalised coordinate units².
    Use to weight loitering detection by zone size.
    """
    n = len(polygon)
    if n < 3:
        return 0.0
    area = 0.0
    for i in range(n):
        j = (i + 1) % n
        area += polygon[i]["x"] * polygon[j]["y"]
        area -= polygon[j]["x"] * polygon[i]["y"]
    return abs(area) / 2.0


def point_to_polygon_distance(point: Dict[str, float], polygon: Polygon) -> float:
    """
    Minimum Euclidean distance from point to the nearest edge of the polygon.
    Returns 0.0 if point is inside the polygon.
    Useful for "near-breach" warning alerts.
    """
    if is_point_in_polygon(point, polygon):
        return 0.0

    px, py = point["x"], point["y"]
    n = len(polygon)
    min_dist = math.inf

    for i in range(n):
        j = (i + 1) % n
        ax, ay = polygon[i]["x"], polygon[i]["y"]
        bx, by = polygon[j]["x"], polygon[j]["y"]

        dx, dy = bx - ax, by - ay
        if dx == 0 and dy == 0:
            dist = math.hypot(px - ax, py - ay)
        else:
            t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
            nearest_x = ax + t * dx
            nearest_y = ay + t * dy
            dist = math.hypot(px - nearest_x, py - nearest_y)

        min_dist = min(min_dist, dist)

    return min_dist




class VirtualFenceEngine:
    """
    Stateful fence engine for one camera.
    Tracks per-target inside/outside state and emits directional breach events.
    """

    def __init__(self, camera_id: str, fence_points: Polygon) -> None:
        self.camera_id = camera_id
        self.fence_points = fence_points
        self._zone_state = ZoneState()
        self._centroid = compute_polygon_centroid(fence_points)
        self._area = compute_polygon_area(fence_points)

    def update_fence(self, new_points: Polygon) -> None:
        """Hot-update fence geometry and reset all target states."""
        self.fence_points = new_points
        self._centroid = compute_polygon_centroid(new_points)
        self._area = compute_polygon_area(new_points)
        self._zone_state.reset()

    def check_targets(
        self,
        targets: List[Dict],          # list of {"id": str, "cx": float, "cy": float}
    ) -> List[BreachResult]:
        """
        Vectorised batch check.  Returns one BreachResult per target.
        """
        if not targets or not self.fence_points or len(self.fence_points) < 3:
            return []

        centers = np.array([[t["cx"], t["cy"]] for t in targets], dtype=np.float64)
        inside_mask = batch_points_in_polygon(centers, self.fence_points)

        results = []
        for i, target in enumerate(targets):
            tid = target["id"]
            is_in = bool(inside_mask[i])
            direction = self._zone_state.update(tid, is_in)
            results.append(BreachResult(
                target_id=tid,
                is_breaching=is_in and direction == BreachDirection.ENTRY,
                direction=direction,
                dwell_seconds=target.get("dwell_seconds", 0.0),
            ))

        return results

    def near_breach_targets(
        self,
        targets: List[Dict],
        warning_distance: float = 0.05,   # 5% of frame width/height
    ) -> List[str]:
        """Return IDs of targets within warning_distance of the fence boundary."""
        result = []
        for t in targets:
            pt = {"x": t["cx"], "y": t["cy"]}
            d = point_to_polygon_distance(pt, self.fence_points)
            if 0 < d <= warning_distance:
                result.append(t["id"])
        return result
