// Cell connections: a dashed line from an anchor point on one tile to an anchor
// point on another (an exit that leads somewhere), optionally bent through
// `via` points, with a dot at each end and an optional label at the midpoint.
// Shared by the viewer and the editor. In the viewer lines are non-interactive so
// clicks still reach the tiles underneath; the editor asks for `interactive`
// lines (a wide invisible hit line) so a connection can be selected and edited.
// A line is only shown while BOTH of its cells pass the caller's visibility gate
// (so a link never leaks the existence of a hidden tile).

import L from 'leaflet';
import type { Connection, Id, Vec2, World } from '../model/types';
import { bilinear, smoothPath, worldToLatLng } from '../model/geometry';

export const LINK_COLOR = '#3b6fd4';
const SELECTED_CASING = '#ffcf4a';

/** The control points of a connection in world units. */
export interface LinkShape {
  from: Vec2;
  via: Vec2[];
  to: Vec2;
}

export interface LinkLayerOptions {
  interactive?: boolean;
  onClick?: (id: Id) => void;
}

interface Drawn {
  conn: Connection;
  casing: L.Polyline;
  line: L.Polyline;
  hit: L.Polyline | null;
  ends: [L.CircleMarker, L.CircleMarker];
  shown: boolean;
}

export class LinkLayerManager {
  private drawn = new Map<Id, Drawn>();
  private layerVisible = true;
  private selected: Id | null = null;
  private cellVisible: (cellId: Id) => boolean = () => true;

  constructor(
    private map: L.Map,
    private pane: string,
    private opts: LinkLayerOptions = {},
  ) {}

  /** Replace/refresh the lines for a world (reconciled by id, so edits don't flicker). */
  setWorld(world: World | null): void {
    const seen = new Set<Id>();
    for (const conn of world?.connections ?? []) {
      const shape = world ? connectionShape(world, conn) : null;
      if (!shape) continue;
      seen.add(conn.id);
      const d = this.drawn.get(conn.id);
      if (!d) {
        this.drawn.set(conn.id, this.create(conn, shape));
        continue;
      }
      d.conn = conn;
      this.applyShape(d, shape);
      applyLabel(d.line, conn.label);
    }
    for (const [id, d] of this.drawn) {
      if (!seen.has(id)) {
        this.show(d, false);
        this.drawn.delete(id);
      }
    }
    this.refresh();
  }

  /** Live preview while a handle is dragged (the world is only updated on release). */
  preview(id: Id, shape: LinkShape): void {
    const d = this.drawn.get(id);
    if (d) this.applyShape(d, shape);
  }

  /** Highlight one connection (editor selection). */
  setSelected(id: Id | null): void {
    if (this.selected === id) return;
    this.selected = id;
    for (const d of this.drawn.values()) this.styleCasing(d);
  }

  /** Gate per cell (viewer: the tile's reveal state). A line needs both ends to pass. */
  setCellVisible(fn: (cellId: Id) => boolean): void {
    this.cellVisible = fn;
    this.refresh();
  }

  setVisible(v: boolean): void {
    this.layerVisible = v;
    this.refresh();
  }

  refresh(): void {
    for (const d of this.drawn.values()) {
      const show =
        this.layerVisible && this.cellVisible(d.conn.from.cellId) && this.cellVisible(d.conn.to.cellId);
      this.show(d, show);
    }
  }

  clear(): void {
    for (const d of this.drawn.values()) this.show(d, false);
    this.drawn.clear();
  }

  private create(conn: Connection, shape: LinkShape): Drawn {
    const base = { pane: this.pane, interactive: false };
    const path = pathLatLngs(shape);
    const casing = L.polyline(path, { ...base, color: '#fff', weight: 6, opacity: 0.85 });
    const line = L.polyline(path, { ...base, color: LINK_COLOR, weight: 2.5, dashArray: '7 6' });
    const dot = (p: Vec2) =>
      L.circleMarker(toLL(p), { ...base, radius: 4, color: LINK_COLOR, weight: 2, fillColor: '#fff', fillOpacity: 1 });
    let hit: L.Polyline | null = null;
    if (this.opts.interactive) {
      hit = L.polyline(path, { pane: this.pane, interactive: true, color: '#000', opacity: 0, weight: 16 });
      hit.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stop(e);
        this.opts.onClick?.(conn.id);
      });
      // Don't let a quick double-click on a line zoom the map out from under the author.
      hit.on('dblclick', (e: L.LeafletMouseEvent) => L.DomEvent.stop(e));
    }
    applyLabel(line, conn.label);
    const d: Drawn = { conn, casing, line, hit, ends: [dot(shape.from), dot(shape.to)], shown: false };
    this.styleCasing(d);
    return d;
  }

  private applyShape(d: Drawn, shape: LinkShape): void {
    const path = pathLatLngs(shape);
    d.casing.setLatLngs(path);
    d.line.setLatLngs(path);
    d.hit?.setLatLngs(path);
    d.ends[0].setLatLng(toLL(shape.from));
    d.ends[1].setLatLng(toLL(shape.to));
    // A permanent tooltip does not follow a polyline whose points change; re-bind it.
    applyLabel(d.line, d.conn.label);
  }

  private styleCasing(d: Drawn): void {
    const on = d.conn.id === this.selected;
    d.casing.setStyle({ color: on ? SELECTED_CASING : '#fff', weight: on ? 9 : 6, opacity: on ? 1 : 0.85 });
  }

  private show(d: Drawn, on: boolean): void {
    if (d.shown === on) return;
    d.shown = on;
    const layers: L.Layer[] = [d.casing, d.line, d.ends[0], d.ends[1]];
    if (d.hit) layers.push(d.hit);
    for (const layer of layers) {
      if (on) layer.addTo(this.map);
      else layer.remove();
    }
  }
}

/** Control points of a connection in world units, or null if either cell is missing. */
export function connectionShape(world: World, conn: Connection): LinkShape | null {
  const a = world.cells.find((c) => c.id === conn.from.cellId);
  const b = world.cells.find((c) => c.id === conn.to.cellId);
  if (!a || !b) return null;
  return {
    from: bilinear(a.geometry.corners, conn.from.uv[0], conn.from.uv[1]),
    via: (conn.via ?? []).map((p): Vec2 => [p[0], p[1]]),
    to: bilinear(b.geometry.corners, conn.to.uv[0], conn.to.uv[1]),
  };
}

const toLL = (p: Vec2) => L.latLng(worldToLatLng(p));

function pathLatLngs(shape: LinkShape): L.LatLng[] {
  return smoothPath([shape.from, ...shape.via, shape.to]).map(toLL);
}

function applyLabel(line: L.Polyline, label: string | undefined): void {
  line.unbindTooltip();
  if (!label) return;
  line.bindTooltip(escapeHtml(label), { permanent: true, direction: 'center', className: 'link-label' });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
