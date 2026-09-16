// Cell rendering: a single affine-transform overlay handles BOTH axis-aligned
// and rotated/skewed tiles, so what the author places is pixel-identical to what
// the player sees (no separate axis-aligned vs rotated code path to drift).
//
// RotatedTileOverlay extends Leaflet's ImageOverlay so it inherits the proven
// pane wiring and zoom-animation plumbing; we override only the geometry math:
// map the image's natural pixel box onto the cell's TL/TR/BL corners via a 2D
// affine matrix. During animated zoom, `_animateZoom` re-projects the corners to
// the target zoom and the element's CSS transition (from the `leaflet-zoom-
// animated` class ImageOverlay adds) interpolates smoothly.

import L from 'leaflet';
import type { Cell, Vec2 } from '../model/types';
import { cellBounds, worldToLatLng, latLngToWorld, boundsIntersect } from '../model/geometry';
import { assetUrl } from '../paths';

// Light checkerboard shown if a tile image fails to load (missing/renamed asset).
const MISSING_TILE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
       <rect width="64" height="64" fill="#8888" />
       <path d="M0 0l64 64M64 0L0 64" stroke="#c33" stroke-width="3"/>
     </svg>`,
  );

export interface TileOptions extends L.ImageOverlayOptions {
  naturalSize: Vec2;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const RotatedTileOverlay = (L.ImageOverlay as any).extend({
  initialize(this: any, url: string, corners: L.LatLng[], options: TileOptions) {
    this._corners = corners; // [TL, TR, BR, BL]
    (L.ImageOverlay.prototype as any).initialize.call(
      this,
      url,
      L.latLngBounds(corners),
      options,
    );
  },

  _reset(this: any) {
    if (!this._image || !this._map) return;
    const m = this._map;
    this._applyAffine(
      m.latLngToLayerPoint(this._corners[0]),
      m.latLngToLayerPoint(this._corners[1]),
      m.latLngToLayerPoint(this._corners[3]),
    );
  },

  _animateZoom(this: any, e: any) {
    if (!this._image || !this._map) return;
    const m = this._map;
    this._applyAffine(
      m._latLngToNewLayerPoint(this._corners[0], e.zoom, e.center),
      m._latLngToNewLayerPoint(this._corners[1], e.zoom, e.center),
      m._latLngToNewLayerPoint(this._corners[3], e.zoom, e.center),
    );
  },

  _applyAffine(this: any, tl: L.Point, tr: L.Point, bl: L.Point) {
    const img: HTMLElement = this._image;
    const [nw, nh] = this.options.naturalSize as Vec2;
    // Columns of the affine: image-x basis (TR-TL)/nw, image-y basis (BL-TL)/nh.
    const a = (tr.x - tl.x) / nw;
    const b = (tr.y - tl.y) / nw;
    const c = (bl.x - tl.x) / nh;
    const d = (bl.y - tl.y) / nh;
    img.style.transformOrigin = '0 0';
    img.style.width = nw + 'px';
    img.style.height = nh + 'px';
    (img.style as any)[L.DomUtil.TRANSFORM] =
      `matrix(${a},${b},${c},${d},${tl.x},${tl.y})`;
  },
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Low-level factory: place `url` on the given world corners. Reused by the editor. */
export function createTileOverlay(
  url: string,
  cornersLatLng: L.LatLng[],
  opts: TileOptions,
): L.ImageOverlay {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new (RotatedTileOverlay as any)(url, cornersLatLng, opts);
}

/** Convert a cell's world corners to Leaflet latLngs (TL,TR,BR,BL order). */
export function cellCornersToLatLng(cell: Cell): L.LatLng[] {
  return cell.geometry.corners.map((c) => L.latLng(worldToLatLng(c)));
}

function makeTileOverlay(cell: Cell, pane: string): L.ImageOverlay {
  return createTileOverlay(assetUrl(cell.image.src), cellCornersToLatLng(cell), {
    naturalSize: cell.image.naturalSize,
    opacity: cell.geometry.opacity ?? 1,
    interactive: true, // clicking a tile opens its reveal popup
    pane,
    className: 'map-tile',
    errorOverlayUrl: MISSING_TILE,
    zIndex: cell.geometry.z,
  });
}

interface CellEntry {
  cell: Cell;
  aabb: { min: Vec2; max: Vec2 };
  overlay: L.ImageOverlay | null;
  label: L.Marker | null;
  added: boolean;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

/**
 * Manages every cell overlay for one world with viewport culling: only tiles
 * whose world-bounds intersect the padded viewport are mounted. A `tileVisible`
 * predicate (Phase 2 reveal gate) can additionally withhold a tile — and while
 * withheld its image is never even fetched (spoiler + bandwidth win).
 */
export class CellLayerManager {
  private entries: CellEntry[] = [];
  private tileVisible: (cell: Cell) => boolean = () => true;
  private onCellClick?: (cell: Cell) => void;
  private labelsVisible = true;
  private labelColorOf: (cell: Cell) => string = () => '#888';

  constructor(
    private map: L.Map,
    private pane: string,
    private labelPane: string,
    private padRatio = 0.25,
  ) {}

  /** Register a click handler invoked when a rendered tile is clicked. */
  setCellClickHandler(fn: (cell: Cell) => void): void {
    this.onCellClick = fn;
  }

  /** Show/hide the persistent cell-name labels. */
  setLabelsVisible(v: boolean): void {
    this.labelsVisible = v;
    this.refresh();
  }

  /** Accent color (per area) applied to a cell's name label. */
  setLabelColorFn(fn: (cell: Cell) => string): void {
    this.labelColorOf = fn;
  }

  setCells(cells: Cell[]): void {
    this.clear();
    this.entries = cells.map((cell) => ({
      cell,
      aabb: cellBounds(cell.geometry.corners),
      overlay: null,
      label: null,
      added: false,
    }));
    this.refresh();
  }

  /** Phase 2 hook: gate which tiles may render at all (reveal/hidden). */
  setTileVisible(fn: (cell: Cell) => boolean): void {
    this.tileVisible = fn;
    this.refresh();
  }

  private viewportWorldBounds(): { min: Vec2; max: Vec2 } {
    const b = this.map.getBounds();
    const nw = b.getNorthWest();
    const se = b.getSouthEast();
    const p1 = latLngToWorld([nw.lat, nw.lng]);
    const p2 = latLngToWorld([se.lat, se.lng]);
    return {
      min: [Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1])],
      max: [Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1])],
    };
  }

  refresh(): void {
    if (!this.entries.length) return;
    const view = this.viewportWorldBounds();
    const w = view.max[0] - view.min[0];
    const h = view.max[1] - view.min[1];
    const pad = Math.max(w, h) * this.padRatio;

    for (const e of this.entries) {
      const shouldShow = this.tileVisible(e.cell) && boundsIntersect(e.aabb, view, pad);
      if (shouldShow && !e.added) {
        if (!e.overlay) {
          e.overlay = makeTileOverlay(e.cell, this.pane);
          const cell = e.cell;
          const overlay = e.overlay;
          overlay.on('click', () => this.onCellClick?.(cell));
          // Tag the <img> with its cell id (debugging + testing hooks).
          overlay.on('add', () => overlay.getElement()?.setAttribute('data-cell', cell.id));
        }
        e.overlay.addTo(this.map);
        e.added = true;
      } else if (!shouldShow && e.added && e.overlay) {
        e.overlay.remove();
        e.added = false;
      }

      // Name labels follow tile visibility + the labels toggle.
      const wantLabel = e.added && this.labelsVisible;
      if (wantLabel && !e.label) {
        e.label = this.makeLabel(e.cell);
        e.label.addTo(this.map);
      } else if (!wantLabel && e.label) {
        e.label.remove();
        e.label = null;
      }
    }
  }

  private makeLabel(cell: Cell): L.Marker {
    const br = cell.geometry.corners[2]; // bottom-right corner
    const color = this.labelColorOf(cell);
    const icon = L.divIcon({
      className: 'cell-label-icon',
      html: `<div class="cell-label" style="border-left-color:${color}">${escapeHtml(cell.name)}</div>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
    return L.marker(L.latLng(worldToLatLng(br)), {
      icon,
      pane: this.labelPane,
      interactive: false,
      keyboard: false,
    });
  }

  clear(): void {
    for (const e of this.entries) {
      if (e.overlay) e.overlay.remove();
      if (e.label) e.label.remove();
    }
    this.entries = [];
  }
}
