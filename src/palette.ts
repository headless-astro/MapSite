// Deterministic per-area colors, used consistently by the map (region outlines)
// and the sidebar legend so a color always means the same area. Pure — no DOM.

const AREA_PALETTE = [
  '#3d7d5a', // green
  '#b5793a', // amber
  '#4a72b0', // blue
  '#9c5ab0', // purple
  '#b04a5a', // rose
  '#3f9a9a', // teal
  '#8a8a3a', // olive
  '#7a5c9e', // violet
  '#c07a2a', // orange
  '#5a7a4a', // moss
];

export function areaColor(index: number): string {
  return AREA_PALETTE[((index % AREA_PALETTE.length) + AREA_PALETTE.length) % AREA_PALETTE.length];
}

/** Map each area id → a stable color, ordered by the area's `order`. */
export function areaColorMap(areas: { id: string; order: number }[]): Map<string, string> {
  const sorted = areas.slice().sort((a, b) => a.order - b.order);
  const m = new Map<string, string>();
  sorted.forEach((a, i) => m.set(a.id, areaColor(i)));
  return m;
}
