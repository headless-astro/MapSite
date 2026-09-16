// Handles for the selected connection: a draggable ring at each end and at every
// bend, plus a small "+" between consecutive points that inserts a new bend when
// clicked. Dragging reports the live shape (for preview) and the final position on
// release; double-clicking a bend removes it. Ends are re-anchored by the store
// (which tile is under the drop point), so this controller only deals in world
// coordinates.

import L from 'leaflet';
import type { Vec2 } from '../model/types';
import { latLngToWorld, worldToLatLng } from '../model/geometry';
import type { LinkShape } from '../map/linkLayer';

export interface LinkHandleCallbacks {
  /** Fired continuously while any handle drags. */
  onLive: (shape: LinkShape) => void;
  /** An end was released at this world point. */
  onEndDrop: (which: 'from' | 'to', at: Vec2) => void;
  /** Bends changed (one moved, or one was removed). */
  onViaChange: (via: Vec2[]) => void;
  /** A "+" was clicked: insert a bend at `index` (into `via`) at this point. */
  onViaInsert: (index: number, at: Vec2) => void;
}

const toLL = (p: Vec2) => L.latLng(worldToLatLng(p));
const fromLL = (ll: L.LatLng): Vec2 => latLngToWorld([ll.lat, ll.lng]);
const clone = (s: LinkShape): LinkShape => ({
  from: [s.from[0], s.from[1]],
  via: s.via.map((p): Vec2 => [p[0], p[1]]),
  to: [s.to[0], s.to[1]],
});

export class LinkHandleController {
  private shape: LinkShape | null = null;
  private handles: L.Marker[] = [];

  constructor(
    private map: L.Map,
    private pane: string,
    private cb: LinkHandleCallbacks,
  ) {}

  show(shape: LinkShape): void {
    this.hide();
    this.shape = clone(shape);
    const s = this.shape;

    this.handles.push(this.dragHandle('link-end', s.from, (p) => (s.from = p), () => this.cb.onEndDrop('from', s.from)));
    this.handles.push(this.dragHandle('link-end', s.to, (p) => (s.to = p), () => this.cb.onEndDrop('to', s.to)));
    s.via.forEach((pt, i) => {
      const h = this.dragHandle('link-via', pt, (p) => (s.via[i] = p), () => this.cb.onViaChange(s.via));
      h.on('dblclick', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stop(e);
        this.cb.onViaChange(s.via.filter((_, j) => j !== i));
      });
      this.handles.push(h);
    });

    // "+" between each pair of consecutive control points.
    const pts = [s.from, ...s.via, s.to];
    for (let i = 0; i < pts.length - 1; i++) {
      const mid: Vec2 = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2];
      const h = this.makeHandle('link-mid', mid, '+', false, 'Add a bend here');
      h.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stop(e);
        this.cb.onViaInsert(i, mid);
      });
      this.handles.push(h);
    }
  }

  hide(): void {
    for (const h of this.handles) h.remove();
    this.handles = [];
    this.shape = null;
  }

  private dragHandle(kind: string, at: Vec2, set: (p: Vec2) => void, commit: () => void): L.Marker {
    const title = kind === 'link-end' ? 'Drag to move this end (drop it on a tile)' : 'Drag to bend · double-click to remove';
    const h = this.makeHandle(kind, at, '', true, title);
    h.on('drag', () => {
      set(fromLL(h.getLatLng()));
      if (this.shape) this.cb.onLive(clone(this.shape));
    });
    h.on('dragend', () => commit());
    return h;
  }

  private makeHandle(kind: string, at: Vec2, glyph: string, draggable: boolean, title: string): L.Marker {
    const icon = L.divIcon({
      className: '',
      html: `<div class="edit-handle ${kind}" title="${title}">${glyph}</div>`,
      iconSize: [0, 0],
    });
    const h = L.marker(toLL(at), { draggable, icon, pane: this.pane, keyboard: false }).addTo(this.map);
    // A click on a handle must not bubble to the map, where it would count as an
    // empty-map click and deselect the connection (dropping these very handles).
    h.on('click', (e: L.LeafletMouseEvent) => L.DomEvent.stop(e));
    return h;
  }
}
