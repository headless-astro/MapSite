// Editor map: renders the draft world's tiles (from staged object-URL images)
// and markers, tracks selection, and hosts the placement handles. Reconciles
// overlays in place (no flicker on edits). Reuses the viewer's exact tile
// renderer (createTileOverlay) so what you place is what players will see.

import L from 'leaflet';
import { DEFAULT_MARKER_SIZE, type Catalog, type Id, type Vec2, type World } from '../model/types';
import { bilinear, latLngToWorld, worldToLatLng } from '../model/geometry';
import { createTileOverlay, cellCornersToLatLng } from '../map/cellLayer';
import { getIcon, indexTaxonomy, resolveResourceIconId } from '../model/taxonomy';
import { PlacementController } from './placement';
import { assetObjectUrl, iconImgUrl, isRasterImage } from './draftStore';

const CELLS_PANE = 'edit-cells'; // 350
const SEL_PANE = 'edit-select'; // 400
const MARK_PANE = 'edit-markers'; // 600
const HANDLE_PANE = 'edit-handles'; // 690

const MISSING =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#8888"/></svg>');

// A subtle canvas grid that pans/zooms with the map (graph-paper backdrop).
/* eslint-disable @typescript-eslint/no-explicit-any */
const CanvasGrid = (L.GridLayer as any).extend({
  createTile(this: any) {
    const tile = document.createElement('canvas');
    const size = this.getTileSize();
    tile.width = size.x;
    tile.height = size.y;
    const ctx = tile.getContext('2d');
    if (ctx) {
      ctx.strokeStyle = 'rgba(0,0,0,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const step = 32;
      for (let x = 0; x <= size.x; x += step) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, size.y);
      }
      for (let y = 0; y <= size.y; y += step) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(size.x, y + 0.5);
      }
      ctx.stroke();
    }
    return tile;
  },
});
/* eslint-enable @typescript-eslint/no-explicit-any */

type Corners = [Vec2, Vec2, Vec2, Vec2];

export interface EditorMapCallbacks {
  onPick: (worldPoint: Vec2, cellId: Id | null) => void;
  onDropFiles: (files: File[], worldPoint: Vec2) => void;
  onGeometryChange: (cellId: Id, corners: Corners) => void;
  onSelect: (cellId: Id) => void;
}

const toLL = (p: Vec2) => L.latLng(worldToLatLng(p));
const CHECKED_COLOR = '#d08a2a';
const NO_IDS: ReadonlySet<Id> = new Set();

export class EditorMap {
  readonly map: L.Map;
  private overlays = new Map<Id, L.ImageOverlay>();
  private overlayHash = new Map<Id, string>();
  private markerDots: L.Marker[] = [];
  private selOutline: L.Polygon | null = null;
  private checkedOutlines = new Map<Id, L.Polygon>();
  private placement: PlacementController;
  private placedFor: Id | null = null;
  private framed = false;
  private world: World | null = null;

  /** true while in add-marker mode: tile clicks place markers instead of dragging. */
  placing = false;
  /** true in multi-select mode: tile clicks toggle ticks and tile bodies don't drag. */
  multiSelect = false;
  private drag: { cellId: Id; start: Vec2; startCorners: Corners; moved: boolean } | null = null;
  private suppressClick = false;

  constructor(
    container: HTMLElement,
    private cb: EditorMapCallbacks,
  ) {
    this.map = L.map(container, {
      crs: L.CRS.Simple,
      minZoom: -6,
      maxZoom: 6,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      attributionControl: false,
    });
    for (const [p, z] of [
      [CELLS_PANE, 350],
      [SEL_PANE, 400],
      [MARK_PANE, 600],
      [HANDLE_PANE, 690],
    ] as [string, number][]) {
      this.map.createPane(p).style.zIndex = String(z);
    }
    this.map.setView(L.latLng(0, 0), -2);

    // Grid backdrop (default tilePane, z-index 200 → below the cells pane).
    // minZoom must be negative — CRS.Simple editing happens at negative zoom, and
    // GridLayer defaults to minZoom:0 (which renders nothing here).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new (CanvasGrid as any)({ minZoom: -10, maxZoom: 10 }).addTo(this.map);

    this.placement = new PlacementController(
      this.map,
      HANDLE_PANE,
      (corners) => this.liveGeometry(corners),
      (corners) => this.placedFor && this.cb.onGeometryChange(this.placedFor, corners),
    );

    this.map.on('click', (e: L.LeafletMouseEvent) => {
      this.cb.onPick(latLngToWorld([e.latlng.lat, e.latlng.lng]), null);
    });
    this.setupDnd(container);
  }

  render(world: World | null, catalog: Catalog, selectedId: Id | null, checked: ReadonlySet<Id> = NO_IDS): void {
    this.world = world;
    if (!world) {
      this.clearAll();
      return;
    }
    // Same CSS variable the viewer uses, so the editor previews the authored marker size.
    this.map.getContainer().style.setProperty('--marker-size', `${world.view.markerSize ?? DEFAULT_MARKER_SIZE}px`);
    // Reconcile tile overlays (add / update in place / remove).
    const seen = new Set<Id>();
    for (const cell of world.cells) {
      seen.add(cell.id);
      const url = assetObjectUrl(cell.image.hash) ?? MISSING;
      let ov = this.overlays.get(cell.id);
      if (!ov) {
        const overlay = createTileOverlay(url, cellCornersToLatLng(cell), {
          naturalSize: cell.image.naturalSize,
          opacity: cell.geometry.opacity ?? 1,
          interactive: true,
          pane: CELLS_PANE,
          className: 'map-tile',
          zIndex: cell.geometry.z,
        });
        const id = cell.id;
        overlay.on('mousedown', (e: L.LeafletMouseEvent) => this.beginCellDrag(e, id));
        overlay.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stop(e);
          if (this.suppressClick) {
            this.suppressClick = false;
            return; // this "click" was the end of a drag — ignore it
          }
          this.cb.onPick(latLngToWorld([e.latlng.lat, e.latlng.lng]), id);
        });
        overlay.on('add', () => {
          const el = overlay.getElement();
          if (!el) return;
          el.setAttribute('data-cell', id);
          // Disable the browser's native image drag — it otherwise starts on
          // mousedown, fights our move-drag, and can fire a phantom file "drop"
          // that duplicates the cell.
          el.setAttribute('draggable', 'false');
          el.addEventListener('dragstart', (ev) => ev.preventDefault());
        });
        overlay.addTo(this.map);
        this.overlays.set(id, overlay);
        this.overlayHash.set(id, cell.image.hash);
        ov = overlay;
      } else {
        // update corners in place
        /* eslint-disable @typescript-eslint/no-explicit-any */
        (ov as any)._corners = cellCornersToLatLng(cell);
        (ov as any)._reset?.();
        /* eslint-enable @typescript-eslint/no-explicit-any */
        if (this.overlayHash.get(cell.id) !== cell.image.hash) {
          ov.setUrl(url);
          this.overlayHash.set(cell.id, cell.image.hash);
        }
        ov.setOpacity(cell.geometry.opacity ?? 1);
        ov.setZIndex(cell.geometry.z);
      }
    }
    for (const [id, ov] of this.overlays) {
      if (!seen.has(id)) {
        ov.remove();
        this.overlays.delete(id);
        this.overlayHash.delete(id);
      }
    }

    this.renderMarkers(world, catalog);
    this.renderSelection(world, selectedId);
    this.renderChecked(world, checked);

    if (!this.framed && world.cells.length) {
      this.frame(world);
      this.framed = true;
    }
  }

  private renderMarkers(world: World, catalog: Catalog): void {
    for (const m of this.markerDots) m.remove();
    this.markerDots = [];
    const tax = indexTaxonomy(catalog);
    for (const cell of world.cells) {
      for (const marker of cell.markers) {
        const pos = bilinear(cell.geometry.corners, marker.uv[0], marker.uv[1]);
        const iconId =
          marker.kind === 'resource'
            ? resolveResourceIconId(tax, marker.refId)
            : catalog.npcTypes.find((t) => t.id === marker.refId)?.icon;
        const iconDef = getIcon(catalog, iconId);
        const inner = iconDef
          ? iconDef.type === 'img'
            ? `<img src="${escHtml(iconImgUrl(iconDef.value))}" alt="" />`
            : escHtml(iconDef.value)
          : marker.kind === 'npc'
            ? '◆'
            : '●';
        const style = marker.size ? ` style="--marker-size:${Number(marker.size)}px"` : '';
        const icon = L.divIcon({
          className: '',
          html: `<div class="edit-marker ${marker.kind}"${style}>${inner}</div>`,
          iconSize: [0, 0],
        });
        const dot = L.marker(toLL(pos), { icon, pane: MARK_PANE, interactive: false, keyboard: false });
        dot.addTo(this.map);
        this.markerDots.push(dot);
      }
    }
  }

  private renderSelection(world: World, selectedId: Id | null): void {
    const cell = selectedId ? world.cells.find((c) => c.id === selectedId) : undefined;
    if (!cell) {
      this.selOutline?.remove();
      this.selOutline = null;
      if (this.placedFor) {
        this.placement.hide();
        this.placedFor = null;
      }
      return;
    }
    const latlngs = cell.geometry.corners.map(toLL);
    const locked = !!cell.geometry.locked;
    if (!this.selOutline) {
      this.selOutline = L.polygon(latlngs, {
        pane: SEL_PANE,
        color: '#2f7fff',
        weight: 2,
        fill: false,
        interactive: false,
      }).addTo(this.map);
    } else {
      this.selOutline.setLatLngs(latlngs);
    }
    // Locked cells: greyed dashed outline, and no move/scale/rotate handles.
    this.selOutline.setStyle({ color: locked ? '#9a9aa0' : '#2f7fff', dashArray: locked ? '5 5' : '' });
    if (locked) {
      if (this.placedFor) {
        this.placement.hide();
        this.placedFor = null;
      }
    } else if (this.placedFor !== cell.id) {
      this.placement.show(cell.geometry.corners);
      this.placedFor = cell.id;
    } else {
      this.placement.update(cell.geometry.corners);
    }
  }

  /** Orange outline on every ticked cell (multi-select mode); reconciled in place. */
  private renderChecked(world: World, checked: ReadonlySet<Id>): void {
    const seen = new Set<Id>();
    for (const cell of world.cells) {
      if (!checked.has(cell.id)) continue;
      seen.add(cell.id);
      const latlngs = cell.geometry.corners.map(toLL);
      const existing = this.checkedOutlines.get(cell.id);
      if (existing) {
        existing.setLatLngs(latlngs);
        continue;
      }
      const poly = L.polygon(latlngs, {
        pane: SEL_PANE,
        color: CHECKED_COLOR,
        weight: 2,
        fillColor: CHECKED_COLOR,
        fillOpacity: 0.15,
        interactive: false,
      }).addTo(this.map);
      this.checkedOutlines.set(cell.id, poly);
    }
    for (const [id, poly] of this.checkedOutlines) {
      if (!seen.has(id)) {
        poly.remove();
        this.checkedOutlines.delete(id);
      }
    }
  }

  private liveGeometry(corners: Corners): void {
    if (!this.placedFor) return;
    this.applyLiveCorners(this.placedFor, corners);
  }

  // --- drag the tile BODY to move the whole cell (owlbear-style) ---
  private beginCellDrag(e: L.LeafletMouseEvent, cellId: Id): void {
    if (this.placing || this.multiSelect) return; // marker mode places, multi-select mode toggles ticks
    const cell = this.world?.cells.find((c) => c.id === cellId);
    if (!cell) return;
    if (cell.geometry.locked) return; // locked cells don't move
    L.DomEvent.stop(e); // stop the map from panning
    this.map.dragging.disable();
    this.drag = {
      cellId,
      start: latLngToWorld([e.latlng.lat, e.latlng.lng]),
      startCorners: cell.geometry.corners.map((p): Vec2 => [p[0], p[1]]) as Corners,
      moved: false,
    };
    this.map.on('mousemove', this.onDragMove);
    this.map.on('mouseup', this.onDragEnd);
  }

  private onDragMove = (e: L.LeafletMouseEvent): void => {
    if (!this.drag) return;
    const now = latLngToWorld([e.latlng.lat, e.latlng.lng]);
    const dx = now[0] - this.drag.start[0];
    const dy = now[1] - this.drag.start[1];
    if (Math.abs(dx) + Math.abs(dy) > 1) this.drag.moved = true;
    this.applyLiveCorners(this.drag.cellId, this.translate(this.drag.startCorners, dx, dy));
  };

  private onDragEnd = (e: L.LeafletMouseEvent): void => {
    const d = this.drag;
    this.drag = null;
    this.map.off('mousemove', this.onDragMove);
    this.map.off('mouseup', this.onDragEnd);
    this.map.dragging.enable();
    if (!d || !d.moved) return;
    const now = latLngToWorld([e.latlng.lat, e.latlng.lng]);
    const corners = this.translate(d.startCorners, now[0] - d.start[0], now[1] - d.start[1]);
    this.suppressClick = true;
    this.cb.onSelect(d.cellId);
    this.cb.onGeometryChange(d.cellId, corners);
  };

  private translate(c: Corners, dx: number, dy: number): Corners {
    return c.map((p): Vec2 => [p[0] + dx, p[1] + dy]) as Corners;
  }

  private applyLiveCorners(cellId: Id, corners: Corners): void {
    const ov = this.overlays.get(cellId);
    if (ov) {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      (ov as any)._corners = corners.map(toLL);
      (ov as any)._reset?.();
      /* eslint-enable @typescript-eslint/no-explicit-any */
    }
    this.checkedOutlines.get(cellId)?.setLatLngs(corners.map(toLL));
    if (this.placedFor === cellId) {
      this.selOutline?.setLatLngs(corners.map(toLL));
      this.placement.update(corners);
    }
  }

  private frame(world: World): void {
    const pts: L.LatLng[] = [];
    for (const cell of world.cells) for (const c of cell.geometry.corners) pts.push(toLL(c));
    if (pts.length) this.map.fitBounds(L.latLngBounds(pts), { padding: [60, 60] });
  }

  /** Re-frame on the next render (e.g. after switching worlds). */
  resetFraming(): void {
    this.framed = false;
  }

  private setupDnd(container: HTMLElement): void {
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    container.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = [...(e.dataTransfer?.files ?? [])].filter((f) => isRasterImage(f));
      if (!files.length) return;
      const rect = container.getBoundingClientRect();
      const pt = L.point(e.clientX - rect.left, e.clientY - rect.top);
      const ll = this.map.containerPointToLatLng(pt);
      this.cb.onDropFiles(files, latLngToWorld([ll.lat, ll.lng]));
    });
  }

  invalidateSize(): void {
    this.map.invalidateSize();
  }

  private clearAll(): void {
    for (const ov of this.overlays.values()) ov.remove();
    this.overlays.clear();
    this.overlayHash.clear();
    for (const m of this.markerDots) m.remove();
    this.markerDots = [];
    this.selOutline?.remove();
    this.selOutline = null;
    for (const poly of this.checkedOutlines.values()) poly.remove();
    this.checkedOutlines.clear();
    this.placement.hide();
    this.placedFor = null;
  }

  destroy(): void {
    this.clearAll();
    this.map.remove();
  }
}

function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
