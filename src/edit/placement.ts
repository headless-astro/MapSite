// Owlbear-style placement handles for the selected tile: MOVE (center), ROTATE
// (above the top edge), and SCALE (bottom-right corner). Handles are draggable
// Leaflet markers; dragging recomputes the cell's 4 corners and emits them live
// (onChange) and on release (onCommit). Keeps rotated rectangles rigid — no free
// distortion in v1 (matches the model's affine assumption).

import L from 'leaflet';
import type { Vec2 } from '../model/types';
import { latLngToWorld, worldToLatLng } from '../model/geometry';

type Corners = [Vec2, Vec2, Vec2, Vec2];

const clone = (c: Corners): Corners => c.map((p): Vec2 => [p[0], p[1]]) as Corners;
const centroid = (c: Corners): Vec2 => [
  (c[0][0] + c[1][0] + c[2][0] + c[3][0]) / 4,
  (c[0][1] + c[1][1] + c[2][1] + c[3][1]) / 4,
];
const mid = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const toLL = (p: Vec2) => L.latLng(worldToLatLng(p));

export class PlacementController {
  private corners: Corners | null = null;
  private moveH?: L.Marker;
  private rotH?: L.Marker;
  private scaleH?: L.Marker;

  constructor(
    private map: L.Map,
    private pane: string,
    private onChange: (c: Corners) => void,
    private onCommit: (c: Corners) => void,
  ) {}

  show(corners: Corners): void {
    this.corners = clone(corners);
    this.clear();
    this.moveH = this.makeHandle('move', this.moveCenter());
    this.rotH = this.makeHandle('rotate', this.rotPoint());
    this.scaleH = this.makeHandle('scale', this.corners[2]);
    this.moveH.on('drag', () => this.onDrag('move'));
    this.rotH.on('drag', () => this.onDrag('rotate'));
    this.scaleH.on('drag', () => this.onDrag('scale'));
    for (const h of [this.moveH, this.rotH, this.scaleH]) {
      h.on('dragend', () => this.corners && this.onCommit(clone(this.corners)));
    }
  }

  /** Reposition handles after an external geometry change (no re-create). */
  update(corners: Corners): void {
    this.corners = clone(corners);
    this.positionAll();
  }

  hide(): void {
    this.clear();
    this.corners = null;
  }

  // --- drag handling ---
  private onDrag(which: 'move' | 'rotate' | 'scale'): void {
    if (!this.corners) return;
    const c = this.corners;
    const ctr = centroid(c);
    if (which === 'move' && this.moveH) {
      const to = latLngToWorld(llArr(this.moveH.getLatLng()));
      const dx = to[0] - ctr[0];
      const dy = to[1] - ctr[1];
      this.corners = c.map((p): Vec2 => [p[0] + dx, p[1] + dy]) as Corners;
    } else if (which === 'rotate' && this.rotH) {
      const to = latLngToWorld(llArr(this.rotH.getLatLng()));
      const up = this.rotUp(); // current "up" direction
      const desired = Math.atan2(to[1] - ctr[1], to[0] - ctr[0]);
      const current = Math.atan2(up[1], up[0]);
      this.corners = rotateAround(c, ctr, desired - current);
    } else if (which === 'scale' && this.scaleH) {
      const to = latLngToWorld(llArr(this.scaleH.getLatLng()));
      const d0 = dist(c[2], ctr);
      const d1 = dist(to, ctr);
      if (d0 > 1e-6) {
        const f = Math.min(20, Math.max(0.05, d1 / d0));
        this.corners = c.map((p): Vec2 => [ctr[0] + (p[0] - ctr[0]) * f, ctr[1] + (p[1] - ctr[1]) * f]) as Corners;
      }
    }
    this.onChange(clone(this.corners));
    this.positionExcept(which);
  }

  private moveCenter(): Vec2 {
    return centroid(this.corners!);
  }
  private rotUp(): Vec2 {
    const c = this.corners!;
    const tm = mid(c[0], c[1]);
    const ctr = centroid(c);
    return [tm[0] - ctr[0], tm[1] - ctr[1]];
  }
  private rotPoint(): Vec2 {
    const ctr = centroid(this.corners!);
    const up = this.rotUp();
    return [ctr[0] + up[0] * 1.35, ctr[1] + up[1] * 1.35];
  }

  private positionAll(): void {
    if (!this.corners) return;
    this.moveH?.setLatLng(toLL(this.moveCenter()));
    this.rotH?.setLatLng(toLL(this.rotPoint()));
    this.scaleH?.setLatLng(toLL(this.corners[2]));
  }
  private positionExcept(which: string): void {
    if (!this.corners) return;
    if (which !== 'move') this.moveH?.setLatLng(toLL(this.moveCenter()));
    if (which !== 'rotate') this.rotH?.setLatLng(toLL(this.rotPoint()));
    if (which !== 'scale') this.scaleH?.setLatLng(toLL(this.corners[2]));
  }

  private makeHandle(kind: 'move' | 'rotate' | 'scale', at: Vec2): L.Marker {
    const glyph = kind === 'move' ? '✥' : kind === 'rotate' ? '↻' : '⤡';
    const icon = L.divIcon({ className: '', html: `<div class="edit-handle ${kind}">${glyph}</div>`, iconSize: [0, 0] });
    const h = L.marker(toLL(at), { draggable: true, icon, pane: this.pane, keyboard: false }).addTo(this.map);
    // A click without a drag must not bubble to the map as an empty-map click (which deselects the tile).
    h.on('click', (e: L.LeafletMouseEvent) => L.DomEvent.stop(e));
    return h;
  }

  private clear(): void {
    for (const h of [this.moveH, this.rotH, this.scaleH]) h?.remove();
    this.moveH = this.rotH = this.scaleH = undefined;
  }
}

function rotateAround(c: Corners, ctr: Vec2, ang: number): Corners {
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  return c.map((p): Vec2 => {
    const dx = p[0] - ctr[0];
    const dy = p[1] - ctr[1];
    return [ctr[0] + dx * cos - dy * sin, ctr[1] + dx * sin + dy * cos];
  }) as Corners;
}

function llArr(ll: L.LatLng): [number, number] {
  return [ll.lat, ll.lng];
}
