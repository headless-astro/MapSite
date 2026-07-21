// Ties the Leaflet map to the cell + marker layers for one world at a time.
// Lives OUTSIDE the Svelte component tree: the view mounts it into a <div> and
// drives it through method calls, so Svelte and Leaflet's imperative DOM never
// fight. Switching worlds tears down the previous world's layers entirely
// (per-world isolation).

import L from 'leaflet';
import type { LoadedWorld, World } from '../model/types';
import { worldToLatLng } from '../model/geometry';
import { searchGate, type SearchState } from '../logic/searchController';
import { CellLayerManager } from './cellLayer';
import { MarkerLayerManager } from './markerLayer';

const CELLS_PANE = 'arelith-cells';

export class MapController {
  readonly map: L.Map;
  private cells: CellLayerManager;
  private markers: MarkerLayerManager;
  private search: SearchState | null = null;

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

    // A dedicated pane keeps tiles below markers regardless of add order.
    const pane = this.map.createPane(CELLS_PANE);
    pane.style.zIndex = '350';

    this.cells = new CellLayerManager(this.map, CELLS_PANE);
    this.markers = new MarkerLayerManager(this.map, 'markerPane');

    // Give the map a view immediately so getBounds()/culling never runs on an
    // un-initialized map (Leaflet throws "Set map center and zoom first"
    // otherwise). frame() replaces this with the world's own view.
    this.map.setView(L.latLng(0, 0), 0);

    // One handler refreshes culling for both layers after any view change.
    this.map.on('moveend zoomend viewreset', this.onViewChange);
  }

  private onViewChange = (): void => {
    this.cells.refresh();
    this.markers.scheduleRefresh();
  };

  /** Load a world (isolated: replaces all prior layers) and frame it. */
  setWorld(loaded: LoadedWorld): void {
    const { world, catalog } = loaded;
    // Frame first so the map has a valid view before culling reads getBounds().
    this.frame(world);
    this.cells.setCells(world.cells);
    this.markers.setWorld(world, catalog);
    this.applyPredicate();
  }

  /** Update the active search selection and re-apply visibility. */
  applySearch(search: SearchState): void {
    this.search = search;
    this.applyPredicate();
  }

  private applyPredicate(): void {
    const search = this.search;
    // Phase 1: reveal gate is always-true; Phase 2 will AND it in here.
    this.markers.setVisible((m, c) => (search ? searchGate(m, c, search) : true));
  }

  private frame(world: World): void {
    this.map.setMinZoom(world.view.minZoom);
    this.map.setMaxZoom(world.view.maxZoom);

    if (world.view.initialCenter && world.view.initialZoom != null) {
      this.map.setView(
        L.latLng(worldToLatLng(world.view.initialCenter)),
        world.view.initialZoom,
      );
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
