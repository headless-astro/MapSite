// Pure geometry helpers. NO Leaflet / DOM imports, so this is unit-testable in a
// plain node environment. The map layer wraps `worldToLatLng` outputs in
// L.latLng(); everything else stays in world units.
//
// World units: origin top-left, x→right, y→DOWN.

import type { Vec2 } from './types';

/** CRS.Simple mapping: world [x,y] → Leaflet [lat,lng] = [-y, x]. */
export function worldToLatLng([x, y]: Vec2): [number, number] {
  return [-y, x];
}

/** Inverse of worldToLatLng: Leaflet [lat,lng] → world [x,y] = [lng, -lat]. */
export function latLngToWorld([lat, lng]: [number, number]): Vec2 {
  return [lng, -lat];
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerp2(a: Vec2, b: Vec2, t: number): Vec2 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
}

/**
 * Bilinear interpolation over a quad [TL, TR, BR, BL] with (u, v) in [0,1]²,
 * where u runs left→right and v runs top→bottom. This is how a marker's
 * normalized `uv` becomes a world position, so it always tracks the tile's
 * current placement (move/scale/rotate/skew all carry markers automatically).
 */
export function bilinear(
  corners: [Vec2, Vec2, Vec2, Vec2],
  u: number,
  v: number,
): Vec2 {
  const [tl, tr, br, bl] = corners;
  const top = lerp2(tl, tr, u);
  const bottom = lerp2(bl, br, u);
  return lerp2(top, bottom, v);
}

/**
 * Corners for a rectangle centered at `center` with `size` [w,h], rotated by
 * `rotDeg` clockwise (visually, since y points down). Order: TL, TR, BR, BL.
 */
export function cornersFromCenter(
  center: Vec2,
  size: Vec2,
  rotDeg = 0,
): [Vec2, Vec2, Vec2, Vec2] {
  const [cx, cy] = center;
  const hw = size[0] / 2;
  const hh = size[1] / 2;
  const local: Vec2[] = [
    [-hw, -hh], // TL
    [hw, -hh], // TR
    [hw, hh], // BR
    [-hw, hh], // BL
  ];
  const rad = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const out = local.map(([lx, ly]): Vec2 => {
    // Standard rotation; with y-down this rotates clockwise on screen.
    const rx = lx * cos - ly * sin;
    const ry = lx * sin + ly * cos;
    return [cx + rx, cy + ry];
  });
  return out as [Vec2, Vec2, Vec2, Vec2];
}

/** Axis-aligned bounding box of a set of points, in world units. */
export function boundsOf(points: Vec2[]): { min: Vec2; max: Vec2 } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { min: [minX, minY], max: [maxX, maxY] };
}

/** World-unit bounding box of a cell's quad. */
export function cellBounds(corners: [Vec2, Vec2, Vec2, Vec2]): {
  min: Vec2;
  max: Vec2;
} {
  return boundsOf(corners);
}

/** Do two AABBs (in world units) overlap, with an optional pad on `a`? */
export function boundsIntersect(
  a: { min: Vec2; max: Vec2 },
  b: { min: Vec2; max: Vec2 },
  pad = 0,
): boolean {
  return (
    a.min[0] - pad <= b.max[0] &&
    a.max[0] + pad >= b.min[0] &&
    a.min[1] - pad <= b.max[1] &&
    a.max[1] + pad >= b.min[1]
  );
}

/**
 * Is this quad an axis-aligned rectangle (within `eps`)? Lets the renderer pick
 * a cheaper path when true, though the transform renderer handles both.
 */
export function isAxisAligned(
  corners: [Vec2, Vec2, Vec2, Vec2],
  eps = 1e-6,
): boolean {
  const [tl, tr, br, bl] = corners;
  return (
    Math.abs(tl[1] - tr[1]) < eps && // top edge horizontal
    Math.abs(bl[1] - br[1]) < eps && // bottom edge horizontal
    Math.abs(tl[0] - bl[0]) < eps && // left edge vertical
    Math.abs(tr[0] - br[0]) < eps // right edge vertical
  );
}

/**
 * Convex hull (Andrew's monotone chain) of a set of world points. Returns the
 * hull vertices in order. Used to draw a region outline around an area's cells.
 */
export function convexHull(points: Vec2[]): Vec2[] {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length <= 2) return pts.map((p): Vec2 => [p[0], p[1]]);
  const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Inverse of `bilinear` for an AFFINE quad (rotated/scaled rectangle): given a
 * world point, return its (u, v) within the cell. Uses TL as origin with basis
 * vectors TR-TL and BL-TL, so it's exact for move/scale/rotate placement (the
 * editor never free-distorts in v1). Used to turn a map click into a marker uv.
 */
export function invBilinearAffine(corners: [Vec2, Vec2, Vec2, Vec2], p: Vec2): Vec2 {
  const [tl, tr, , bl] = corners;
  const bx: Vec2 = [tr[0] - tl[0], tr[1] - tl[1]];
  const by: Vec2 = [bl[0] - tl[0], bl[1] - tl[1]];
  const dx = p[0] - tl[0];
  const dy = p[1] - tl[1];
  const det = bx[0] * by[1] - bx[1] * by[0];
  if (Math.abs(det) < 1e-9) return [0.5, 0.5];
  return [(dx * by[1] - dy * by[0]) / det, (bx[0] * dy - bx[1] * dx) / det];
}

/** Push each polygon vertex outward from the centroid by `pad` world units. */
/**
 * A smooth open curve through every one of `points` (Catmull-Rom spline), sampled
 * `segments` times per span. Two points come back as the straight segment itself.
 * Used to draw bent cell connections.
 */
export function smoothPath(points: Vec2[], segments = 8): Vec2[] {
  if (points.length < 3) return points.map((p): Vec2 => [p[0], p[1]]);
  const n = points.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(n - 1, i + 2)];
    for (let s = 0; s < segments; s++) out.push(catmullRom(p0, p1, p2, p3, s / segments));
  }
  out.push([points[n - 1][0], points[n - 1][1]]);
  return out;
}

function catmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
}

export function expandPolygon(points: Vec2[], pad: number): Vec2[] {
  if (points.length === 0) return [];
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
  const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
  return points.map(([x, y]): Vec2 => {
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.hypot(dx, dy) || 1;
    return [x + (dx / d) * pad, y + (dy / d) * pad];
  });
}
