// Ties the Leaflet map to the cell + marker + area layers for one world at a
// time. Lives OUTSIDE the Svelte component tree: the view mounts it into a <div>
// and drives it through method calls, so Svelte and Leaflet's imperative DOM
// never fight. Switching worlds tears down the previous world's layers entirely
// (per-world isolation).

import L from 'leaflet';
import { DEFAULT_MARKER_SIZE, type Cell, type LoadedWorld, type World } from '../model/types';
import { bilinear, worldToLatLng } from '../model/geometry';
import { areaColorMap } from '../palette';
import { type SearchState } from '../logic/searchController';
import {
  emptyRevealState,
  markerVisible,
  tileVisible,
  type RevealState,
} from '../logic/revealController';
import { CellLayerManager } from './cellLayer';
import { MarkerLayerManager } from './markerLayer';
import { AreaLayerManager } from './areaLayer';
import { LinkLayerManager } from './linkLayer';
import { buildCellPopup, type CellRevealHandlers } from './cellPopup';

const CELLS_PANE = 'map-cells'; // z 350
const AREAS_PANE = 'map-areas'; // z 330 (region outlines, below tiles)
const LABELS_PANE = 'map-cell-labels'; // z 450 (above tiles, below markers)
const LINKS_PANE = 'map-links'; // z 460 (cell connections: above labels, below markers)

export interface DisplayPrefs {
  cellLabels: boolean;
  areaRegions: boolean;
  connections: boolean;
}

export class MapController {
  readonly map: L.Map;
  private cells: CellLayerManager;
  private markers: MarkerLayerManager;
  private areas: AreaLayerManager;
  private links: LinkLayerManager;

  private world: World | null = null;
  private search: SearchState | null = null;
  private reveal: RevealState = emptyRevealState();
  private revealHandlers: CellRevealHandlers | null = null;
  private prefs: DisplayPrefs = { cellLabels: true, areaRegions: true, connections: true };

  constructor(container: HTMLElement) {
    this.map = L.map(container, {
      crs: L.CRS.Simple,
      minZoom: -6,
      maxZoom: 6,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 120,
      attributionControl: false,
      zoomControl: true,
      preferCanvas: false,
    });

    this.makePane(AREAS_PANE, 330);
    this.makePane(CELLS_PANE, 350);
    this.makePane(LABELS_PANE, 450);
    this.makePane(LINKS_PANE, 460);

    this.areas = new AreaLayerManager(this.map, AREAS_PANE);
    this.cells = new CellLayerManager(this.map, CELLS_PANE, LABELS_PANE);
    this.markers = new MarkerLayerManager(this.map, 'markerPane');
    this.links = new LinkLayerManager(this.map, LINKS_PANE);
    this.cells.setCellClickHandler((cell) => this.handleCellClick(cell));

    // Give the map a view immediately so getBounds()/culling never runs on an
    // un-initialized map (Leaflet throws "Set map center and zoom first").
    this.map.setView(L.latLng(0, 0), 0);

    this.map.on('moveend zoomend viewreset', this.onViewChange);
  }

  private makePane(name: string, zIndex: number): void {
    this.map.createPane(name).style.zIndex = String(zIndex);
  }

  /** Provide the store callbacks the cell popup invokes. */
  setRevealHandlers(handlers: CellRevealHandlers): void {
    this.revealHandlers = handlers;
  }

  private onViewChange = (): void => {
    this.cells.refresh();
    this.markers.scheduleRefresh();
  };

  /** Load a world (isolated: replaces all prior layers) and frame it. */
  setWorld(loaded: LoadedWorld, reveal: RevealState, search: SearchState): void {
    const { world, catalog } = loaded;
    this.world = world;
    this.reveal = reveal;
    this.search = search;

    // Authored marker size: every .marker-icon reads this variable from the map container.
    this.map.getContainer().style.setProperty('--marker-size', `${world.view.markerSize ?? DEFAULT_MARKER_SIZE}px`);

    const colors = areaColorMap(world.areas);
    const colorOf = (areaId: string | null) => (areaId ? (colors.get(areaId) ?? '#888') : '#888');

    // Frame first so the map has a valid view before culling reads getBounds().
    this.frame(world);

    this.cells.setLabelColorFn((cell) => colorOf(cell.areaId));
    this.cells.setLabelsVisible(this.prefs.cellLabels);
    this.cells.setTileVisible((cell) => tileVisible(cell, this.reveal));
    this.cells.setCells(world.cells);

    this.areas.setAreas(world, (id) => colorOf(id));
    this.areas.setVisible(this.prefs.areaRegions);

    this.markers.setWorld(world, catalog);
    this.links.setWorld(world);
    this.links.setVisible(this.prefs.connections);
    this.applyPredicate();
  }

  /** Apply new reveal + search state to the current world (no world reload). */
  applyState(reveal: RevealState, search: SearchState): void {
    this.reveal = reveal;
    this.search = search;
    // Tile gate may have changed (area reveal-hidden) → re-cull tiles + labels.
    this.cells.setTileVisible((cell) => tileVisible(cell, this.reveal));
    this.applyPredicate();
  }

  /** Toggle persistent cell labels / area region outlines / cell connections. */
  setDisplayPrefs(prefs: DisplayPrefs): void {
    this.prefs = prefs;
    this.cells.setLabelsVisible(prefs.cellLabels);
    this.areas.setVisible(prefs.areaRegions);
    this.links.setVisible(prefs.connections);
  }

  private applyPredicate(): void {
    const world = this.world;
    const reveal = this.reveal;
    const search = this.search;
    this.markers.setVisible((m, c) =>
      world && search ? markerVisible(m, c, reveal, search, world) : true,
    );
    // A connection shows only while both of its tiles render (R1), so it can't hint at a hidden cell.
    const byId = new Map((world?.cells ?? []).map((c) => [c.id, c] as const));
    this.links.setCellVisible((id) => {
      const cell = byId.get(id);
      return !!cell && tileVisible(cell, reveal);
    });
  }

  private handleCellClick(cell: Cell): void {
    if (!this.world || !this.revealHandlers) return;
    const area = cell.areaId ? this.world.areas.find((a) => a.id === cell.areaId) : undefined;
    const content = buildCellPopup(cell, area, this.reveal, this.revealHandlers);
    const center = L.latLng(worldToLatLng(bilinear(cell.geometry.corners, 0.5, 0.5)));
    L.popup({ className: 'cell-leaflet-popup', closeButton: true })
      .setLatLng(center)
      .setContent(content)
      .openOn(this.map);
  }

  private frame(world: World): void {
    this.map.setMinZoom(world.view.minZoom);
    this.map.setMaxZoom(world.view.maxZoom);

    if (world.view.initialCenter && world.view.initialZoom != null) {
      this.map.setView(L.latLng(worldToLatLng(world.view.initialCenter)), world.view.initialZoom);
      return;
    }
    const bounds = worldBounds(world);
    if (bounds) this.map.fitBounds(bounds, { padding: [40, 40] });
    else this.map.setView(L.latLng(0, 0), 0);
  }

  invalidateSize(): void {
    this.map.invalidateSize();
  }

  destroy(): void {
    this.map.off('moveend zoomend viewreset', this.onViewChange);
    this.cells.clear();
    this.markers.clear();
    this.areas.clear();
    this.links.clear();
    this.map.remove();
  }
}

/** Combined LatLng bounds of every cell's quad, or null if the world is empty. */
function worldBounds(world: World): L.LatLngBounds | null {
  const pts: L.LatLng[] = [];
  for (const cell of world.cells) {
    for (const corner of cell.geometry.corners) {
      pts.push(L.latLng(worldToLatLng(corner)));
    }
  }
  return pts.length ? L.latLngBounds(pts) : null;
}
