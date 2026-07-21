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

interface TileOptions extends L.ImageOverlayOptions {
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

function makeTileOverlay(cell: Cell, pane: string): L.ImageOverlay {
  const cornersLL = cell.geometry.corners.map((c) => L.latLng(worldToLatLng(c)));
  const opts: TileOptions = {
    naturalSize: cell.image.naturalSize,
    opacity: cell.geometry.opacity ?? 1,
    interactive: false,
    pane,
    className: 'arelith-tile',
    errorOverlayUrl: MISSING_TILE,
    zIndex: cell.geometry.z,
  };
  return new (RotatedTileOverlay as any)(assetUrl(cell.image.src), cornersLL, opts);
}

interface CellEntry {
  cell: Cell;
  aabb: { min: Vec2; max: Vec2 };
  overlay: L.ImageOverlay | null;
  added: boolean;
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

  constructor(
    private map: L.Map,
    private pane: string,
    private padRatio = 0.25,
  ) {}

  setCells(cells: Cell[]): void {
    this.clear();
    this.entries = cells.map((cell) => ({
      cell,
      aabb: cellBounds(cell.geometry.corners),
      overlay: null,
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
        if (!e.overlay) e.overlay = makeTileOverlay(e.cell, this.pane);
        e.overlay.addTo(this.map);
        e.added = true;
      } else if (!shouldShow && e.added && e.overlay) {
        e.overlay.remove();
        e.added = false;
      }
    }
  }

  clear(): void {
    for (const e of this.entries) {
      if (e.overlay) e.overlay.remove();
    }
    this.entries = [];
  }
}
