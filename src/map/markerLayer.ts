// Marker rendering: a registry of every marker in the loaded world with
// precomputed world positions and inverted indexes, plus viewport culling and a
// pluggable visibility predicate.
//
// Phase 1 supplies a search-only predicate; Phase 2 ANDs in the reveal gate.
// A marker's world position is bilinear(cell.corners, u, v), so it always tracks
// the tile — and only markers inside the padded viewport are mounted.

import L from 'leaflet';
import type { Catalog, Cell, Id, Marker, MarkerKind, World } from '../model/types';
import { bilinear, worldToLatLng } from '../model/geometry';
import { assetUrl } from '../paths';
import {
  getIcon,
  indexTaxonomy,
  npcTypeName,
  resolveResourceIconId,
  resolveResourceName,
  type TaxIndex,
} from '../model/taxonomy';

/** Fallback glyph per kind when neither the leaf nor its ancestors define an icon. */
export const KIND_GLYPH: Record<MarkerKind, string> = { resource: '●', npc: '◆', location: '▲', enemy: '✖' };

/** Display name for a marker: its override, else its leaf/type name. */
export function markerLabel(marker: Marker, catalog: Catalog, tax: TaxIndex): string {
  if (marker.nameOverride) return marker.nameOverride;
  return marker.kind === 'npc' ? npcTypeName(catalog, marker.refId) : resolveResourceName(tax, marker.refId);
}

/** Icon id for a marker: a typed NPC's type icon, or the leaf's icon (inherited up the tree). */
export function markerIconId(marker: Marker, catalog: Catalog, tax: TaxIndex): Id | undefined {
  return marker.kind === 'npc'
    ? catalog.npcTypes.find((t) => t.id === marker.refId)?.icon
    : resolveResourceIconId(tax, marker.refId);
}

export interface MarkerEntry {
  marker: Marker;
  cell: Cell;
  latLng: L.LatLng;
  label: string;
  iconHtml: string;
  leaflet: L.Marker | null;
  added: boolean;
}

export type MarkerPredicate = (marker: Marker, cell: Cell) => boolean;

export class MarkerLayerManager {
  private entries: MarkerEntry[] = [];
  private visible: MarkerPredicate = () => true;
  private rafHandle: number | null = null;

  // Inverted indexes for targeted updates / counts (built once per world).
  readonly byRef: Record<MarkerKind, Map<Id, MarkerEntry[]>> = {
    resource: new Map(),
    npc: new Map(),
    location: new Map(),
    enemy: new Map(),
  };
  readonly byArea = new Map<Id, MarkerEntry[]>();
  readonly byCell = new Map<Id, MarkerEntry[]>();

  constructor(
    private map: L.Map,
    private pane: string,
  ) {}

  setWorld(world: World, catalog: Catalog): void {
    this.clear();
    const tax: TaxIndex = indexTaxonomy(catalog);

    for (const cell of world.cells) {
      for (const marker of cell.markers) {
        const worldPos = bilinear(cell.geometry.corners, marker.uv[0], marker.uv[1]);
        const latLng = L.latLng(worldToLatLng(worldPos));
        const label = markerLabel(marker, catalog, tax);
        const iconHtml = this.iconHtmlFor(marker, catalog, tax);
        const entry: MarkerEntry = {
          marker,
          cell,
          latLng,
          label,
          iconHtml,
          leaflet: null,
          added: false,
        };
        this.entries.push(entry);
        pushIndex(this.byCell, cell.id, entry);
        if (cell.areaId) pushIndex(this.byArea, cell.areaId, entry);
        if (marker.refId) pushIndex(this.byRef[marker.kind], marker.refId, entry);
      }
    }
    this.refresh();
  }

  setVisible(fn: MarkerPredicate): void {
    this.visible = fn;
    this.scheduleRefresh();
  }

  /** Coalesce rapid toggles into a single frame of DOM work. */
  scheduleRefresh(): void {
    if (this.rafHandle != null) return;
    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = null;
      this.refresh();
    });
  }

  refresh(): void {
    if (!this.entries.length) return;
    const bounds = this.map.getBounds().pad(0.25);
    for (const e of this.entries) {
      const show = this.visible(e.marker, e.cell) && bounds.contains(e.latLng);
      if (show && !e.added) {
        if (!e.leaflet) e.leaflet = this.makeMarker(e);
        e.leaflet.addTo(this.map);
        e.added = true;
      } else if (!show && e.added && e.leaflet) {
        e.leaflet.remove();
        e.added = false;
      }
    }
  }

  clear(): void {
    if (this.rafHandle != null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    for (const e of this.entries) if (e.leaflet) e.leaflet.remove();
    this.entries = [];
    for (const m of Object.values(this.byRef)) m.clear();
    this.byArea.clear();
    this.byCell.clear();
  }

  private makeMarker(e: MarkerEntry): L.Marker {
    const icon = L.divIcon({
      className: '',
      html: e.iconHtml,
      iconSize: [0, 0], // sizing handled by .marker-icon CSS
    });
    const m = L.marker(e.latLng, { icon, pane: this.pane, title: e.label });
    const note = e.marker.note ? `<div class="muted">${escapeHtml(e.marker.note)}</div>` : '';
    m.bindPopup(`<strong>${escapeHtml(e.label)}</strong>${note}`);
    return m;
  }

  private iconHtmlFor(marker: Marker, catalog: Catalog, tax: TaxIndex): string {
    const icon = getIcon(catalog, markerIconId(marker, catalog, tax));
    const cls = `marker-icon ${marker.kind}`;
    let inner = KIND_GLYPH[marker.kind];
    if (icon) {
      // Escape BOTH branches: icon.value is contributor-controlled and flows into
      // innerHTML via Leaflet's divIcon. Emoji are visually unaffected by escaping;
      // a malicious "<img onerror=…>" emoji value would otherwise run as script.
      inner =
        icon.type === 'emoji'
          ? escapeHtml(icon.value)
          : `<img src="${escapeHtml(assetUrl(icon.value))}" alt="" />`; // sized by .marker-icon img CSS
    }
    const styles: string[] = [];
    if (icon?.color) styles.push(`border-color:${escapeHtml(icon.color)}`);
    if (marker.size) styles.push(`--marker-size:${Number(marker.size)}px`); // per-marker override
    const style = styles.length ? ` style="${styles.join(';')}"` : '';
    return `<div class="${cls}"${style}>${inner}</div>`;
  }
}

function pushIndex(map: Map<Id, MarkerEntry[]>, key: Id, entry: MarkerEntry): void {
  const arr = map.get(key);
  if (arr) arr.push(entry);
  else map.set(key, [entry]);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}
