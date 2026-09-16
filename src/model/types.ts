// ============================================================================
// Canonical data model (SHARED between viewer and editor)
//
// The editor WRITES this shape; the viewer READS it. Both compile against this
// file, so the two can never drift. Nothing here depends on Leaflet or the DOM.
//
// Coordinate convention: "world units" are image-style — origin top-left,
// x increases right, y increases DOWN. Conversion to Leaflet CRS.Simple LatLng
// happens only in the map layer (see model/geometry.ts `worldToLatLng`).
// ============================================================================

export type Id = string;
/** A point in world units: [x, y]. */
export type Vec2 = [number, number];

/** Current schema version for committed data. Bump + add a migration on change. */
export const SCHEMA_VERSION = 1;

/** Marker diameter in CSS px when a world sets no `view.markerSize` (keep in sync with --marker-size in app.css). */
export const DEFAULT_MARKER_SIZE = 26;
export const MARKER_SIZE_MIN = 12;
export const MARKER_SIZE_MAX = 72;

// ---------------------------------------------------------------------------
// data/index.json — manifest (always loaded, tiny)
// ---------------------------------------------------------------------------
export interface Manifest {
  schemaVersion: number;
  app: 'map-site';
  catalog: string; // relative path, e.g. "catalog.json"
  worlds: WorldRef[];
}
export interface WorldRef {
  id: Id;
  slug: string; // human-readable, for #/w/<slug> deep-links
  name: string;
  data: string; // relative path to the world file, e.g. "worlds/wld_surface.json"
  thumbnail?: string;
}

// ---------------------------------------------------------------------------
// data/catalog.json — SHARED definitions (always loaded, small)
// ---------------------------------------------------------------------------
export interface Catalog {
  schemaVersion: number;
  resources: TaxNode[]; // a FOREST; only kind:"resource" nodes are markerable
  npcTypes: NpcType[]; // flat; NPC search targets the type
  icons: Record<Id, Icon>;
}

/**
 * One taxonomy node. `kind` is explicit (NOT inferred from empty children) so an
 * intermediate group with no children yet is never mistaken for a resource.
 * - "group"    → a type or subtype; may have children; NOT markerable.
 * - "resource" → a leaf a marker can reference; should have no children.
 */
export interface TaxNode {
  id: Id;
  name: string;
  order: number;
  kind: 'group' | 'resource';
  icon?: Id;
  children?: TaxNode[];
}

export interface NpcType {
  id: Id;
  name: string;
  order: number;
  icon?: Id;
}

export interface Icon {
  type: 'emoji' | 'img';
  value: string; // emoji char(s), or "assets/icons/<hash>.png"
  color?: string;
}

// ---------------------------------------------------------------------------
// data/worlds/<id>.json — per-world (lazy, one at a time)
// ---------------------------------------------------------------------------
export interface World {
  schemaVersion: number;
  id: Id;
  slug: string;
  name: string;
  view: {
    minZoom: number;
    maxZoom: number;
    fitAll?: boolean;
    initialCenter?: Vec2;
    initialZoom?: number;
    /** Marker diameter in CSS px (default DEFAULT_MARKER_SIZE); emoji and image icons scale with it. */
    markerSize?: number;
  };
  config: {
    /** Default true: search can only narrow what reveal permits, never surface hidden markers. */
    searchRespectsReveal: boolean;
    /** Optional zoom-based declutter (Phase 5). Default off. */
    declutter: { enabled: boolean; hideMarkersBelowZoom: number | null };
  };
  areas: Area[];
  cells: Cell[]; // markers are embedded in their cell
  /** Drawn links between cells (an exit on one map leading into another). */
  connections?: Connection[];
}

/** One end of a connection: a normalized anchor point inside a cell's image ([0.5, 0.5] = centre). */
export interface ConnectionEnd {
  cellId: Id;
  uv: Vec2;
}

export interface Connection {
  id: Id;
  from: ConnectionEnd;
  to: ConnectionEnd;
  /** Bend points in world units, in order from `from` to `to`; the line is drawn as a smooth curve through them. */
  via?: Vec2[];
  /** Optional short text shown at the midpoint, e.g. "ladder down". */
  label?: string;
}

export interface Area {
  id: Id;
  name: string;
  order: number;
  /**
   * Authored defaults that CASCADE to this area's cells (a cell's own
   * defaultReveal overrides). Honors "areas AND cells carry toggle settings".
   */
  defaultReveal?: { resources: boolean; npcs: boolean };
  /** If true, all cells in this area behave as hidden unless individually overridden. */
  hidden?: boolean;
  // Per-area "reveal hidden" is a VIEW control stored in player state, not here.
}

export interface CellImage {
  src: string; // relative path, e.g. "assets/wld_surface/img/<hash>.png"
  hash: string;
  mime: string;
  naturalSize: Vec2; // [w, h] in image pixels
}

export interface CellGeometry {
  /** Canonical placement: TL, TR, BR, BL in world units. Supports rotation/skew. */
  corners: [Vec2, Vec2, Vec2, Vec2];
  z: number; // draw order among overlapping tiles
  opacity?: number; // 0..1, default 1
  locked?: boolean; // author-only; ignored by viewer
}

export interface Cell {
  id: Id;
  name: string;
  areaId: Id | null;
  order: number;
  image: CellImage;
  geometry: CellGeometry;
  /** true ⇒ tile not rendered (nor its image fetched) until its area is revealed. */
  hidden: boolean;
  /** "shown-with-markers-hidden" defaults; may inherit from the area. */
  defaultReveal: { resources: boolean; npcs: boolean };
  /** FUTURE keyword-unlock (Phase 6). Present but INERT in v1. */
  unlock?: { keywords: string[] };
  markers: Marker[];
}

export interface Marker {
  id: Id;
  kind: 'resource' | 'npc';
  /** resource-leaf id, or npcType id; null = unique untyped NPC (rendered, not searchable). */
  refId: Id | null;
  /** normalized position within the cell image: [u, v] in [0,1]. */
  uv: Vec2;
  nameOverride?: string;
  /** Per-marker diameter in CSS px; overrides the world's view.markerSize. */
  size?: number;
  /** author escape hatch: never shown regardless of reveal/search. */
  hidden?: boolean;
  note?: string;
}

// ---------------------------------------------------------------------------
// Convenience: a fully-loaded world paired with the catalog it resolves against.
// ---------------------------------------------------------------------------
export interface LoadedWorld {
  world: World;
  catalog: Catalog;
}
