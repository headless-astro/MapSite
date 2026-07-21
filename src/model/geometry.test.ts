import { describe, expect, it } from 'vitest';
import {
  bilinear,
  boundsIntersect,
  cellBounds,
  cornersFromCenter,
  isAxisAligned,
  latLngToWorld,
  worldToLatLng,
} from './geometry';
import type { Vec2 } from './types';

describe('worldToLatLng / latLngToWorld', () => {
  it('maps [x,y] → [-y, x] and round-trips', () => {
    expect(worldToLatLng([3, 5])).toEqual([-5, 3]);
    expect(latLngToWorld([-5, 3])).toEqual([3, 5]);
  });
});

describe('bilinear', () => {
  const corners: [Vec2, Vec2, Vec2, Vec2] = [
    [0, 0], // TL
    [10, 0], // TR
    [10, 20], // BR
    [0, 20], // BL
  ];
  it('hits each corner at its uv', () => {
    expect(bilinear(corners, 0, 0)).toEqual([0, 0]);
    expect(bilinear(corners, 1, 0)).toEqual([10, 0]);
    expect(bilinear(corners, 1, 1)).toEqual([10, 20]);
    expect(bilinear(corners, 0, 1)).toEqual([0, 20]);
  });
  it('returns the center at (0.5, 0.5)', () => {
    expect(bilinear(corners, 0.5, 0.5)).toEqual([5, 10]);
  });
});

describe('cornersFromCenter', () => {
  it('produces an axis-aligned rectangle at rot 0', () => {
    const c = cornersFromCenter([10, 10], [4, 2], 0);
    expect(c).toEqual([
      [8, 9],
      [12, 9],
      [12, 11],
      [8, 11],
    ]);
    expect(isAxisAligned(c)).toBe(true);
  });

  it('keeps the center under bilinear for any rotation', () => {
    const c = cornersFromCenter([100, 50], [40, 20], 37);
    const mid = bilinear(c, 0.5, 0.5);
    expect(mid[0]).toBeCloseTo(100, 6);
    expect(mid[1]).toBeCloseTo(50, 6);
    expect(isAxisAligned(c)).toBe(false);
  });

  it('preserves edge lengths under rotation', () => {
    const c = cornersFromCenter([0, 0], [6, 4], 30);
    const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    expect(dist(c[0], c[1])).toBeCloseTo(6, 6); // TL→TR = width
    expect(dist(c[1], c[2])).toBeCloseTo(4, 6); // TR→BR = height
  });
});

describe('cellBounds / boundsIntersect', () => {
  it('computes an AABB of a rotated quad', () => {
    const c = cornersFromCenter([0, 0], [10, 10], 45);
    const b = cellBounds(c);
    const half = (10 / 2) * Math.SQRT2;
    expect(b.min[0]).toBeCloseTo(-half, 4);
    expect(b.max[0]).toBeCloseTo(half, 4);
  });

  it('detects overlap and separation, honoring pad', () => {
    const a = { min: [0, 0] as Vec2, max: [10, 10] as Vec2 };
    const b = { min: [20, 0] as Vec2, max: [30, 10] as Vec2 };
    expect(boundsIntersect(a, b)).toBe(false);
    expect(boundsIntersect(a, b, 15)).toBe(true); // pad bridges the gap
  });
});
