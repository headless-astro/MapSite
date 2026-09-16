// The editor's working state and every mutation on it. Plain Svelte stores so
// the map controller and the panels react to one source of truth. Persists to
// Dexie (debounced) so work survives a reload. Nothing here is deployed.

import { get, writable } from 'svelte/store';
import type {
  Catalog,
  Cell,
  Connection,
  ConnectionEnd,
  Id,
  Marker,
  MarkerKind,
  MarkerLink,
  TaxKind,
  TaxNode,
  Vec2,
  World,
} from '../model/types';
import { MARKER_SIZE_MAX, MARKER_SIZE_MIN, SCHEMA_VERSION, TAX_FIELD, TAX_KINDS } from '../model/types';
import { forestOf } from '../model/taxonomy';
import { newId, slugify, type IdPrefix } from '../model/ids';
import { cornersFromCenter, invBilinearAffine } from '../model/geometry';
import { db, extFromMime, hashBlob, type AssetBlob } from './db';

export type EditMode =
  | { kind: 'select' }
  /** Placing markers of one kind; refId null = untyped NPC. */
  | { kind: 'place'; markerKind: MarkerKind; refId: Id | null }
  /** Drawing a connection: `from` is set after the first tile click. */
  | { kind: 'connect'; from: ConnectionEnd | null };

export const catalog = writable<Catalog>(emptyCatalog());
export const worlds = writable<World[]>([]);
export const activeWorldId = writable<Id | null>(null);
export const selectedCellId = writable<Id | null>(null);
/** The connection whose handles are shown on the map. Never set together with a selected cell. */
export const selectedLinkId = writable<Id | null>(null);
selectedCellId.subscribe((id) => {
  if (id !== null) selectedLinkId.set(null);
});
export const editMode = writable<EditMode>({ kind: 'select' });
/** Multi-select mode: lists show tick boxes and tile clicks toggle cells, for bulk deletes. */
export const multiSelect = writable(false);
/** Ids ticked in multi-select mode. One set serves every kind — ids are unique across kinds. */
export const checkedIds = writable<ReadonlySet<Id>>(new Set());
export const draftReady = writable(false);
export const editorToast = writable<string | null>(null);
export const dirtyAt = writable<number>(0);

// hash → object URL for rendering staged blobs (recreated each session).
const objectUrls = new Map<string, string>();
export function assetObjectUrl(hash: string): string | undefined {
  return objectUrls.get(hash);
}

const RASTER_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/avif',
]);
/** Only raster images are allowed as tiles/icons — an SVG can carry <script>. */
export function isRasterImage(file: File): boolean {
  return RASTER_MIME.has(file.type);
}

function emptyCatalog(): Catalog {
  return { schemaVersion: SCHEMA_VERSION, resources: [], locations: [], enemies: [], npcTypes: [], icons: {} };
}

export function activeWorld(): World | null {
  const id = get(activeWorldId);
  return get(worlds).find((w) => w.id === id) ?? null;
}

export function selectedCell(): Cell | null {
  const w = activeWorld();
  const id = get(selectedCellId);
  return w?.cells.find((c) => c.id === id) ?? null;
}

// --------------------------------------------------------------------------
// Persistence
// --------------------------------------------------------------------------
let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(): void {
  dirtyAt.set(Date.now());
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(persistNow, 500);
}
export async function persistNow(): Promise<void> {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  await db.drafts.put({
    id: 'draft',
    catalog: get(catalog),
    worlds: get(worlds),
    updatedAt: Date.now(),
  });
}

// Immutable update of the active world: replaces the world (and whatever the
// callback rebuilds) with NEW object references, so Svelte's $derived chains
// (which compare by identity) actually detect the change and re-render.
function updateActiveWorld(fn: (w: World) => World): void {
  const id = get(activeWorldId);
  worlds.update((ws) => ws.map((w) => (w.id === id ? fn(w) : w)));
  schedulePersist();
}
function updateCatalog(fn: (c: Catalog) => Catalog): void {
  catalog.update(fn);
  schedulePersist();
}

// --------------------------------------------------------------------------
// Init / load
// --------------------------------------------------------------------------
export async function initDraft(): Promise<void> {
  const doc = await db.drafts.get('draft');
  const assets = await db.assets.toArray();
  for (const a of assets) {
    if (!objectUrls.has(a.hash)) objectUrls.set(a.hash, URL.createObjectURL(a.blob));
  }
  if (doc) {
    catalog.set(doc.catalog);
    worlds.set(doc.worlds);
    activeWorldId.set(doc.worlds[0]?.id ?? null);
  }
  draftReady.set(true);
}

/** Replace the whole draft (used by Import). Stages the given assets. */
export async function loadProject(
  nextCatalog: Catalog,
  nextWorlds: World[],
  assets: AssetBlob[],
): Promise<void> {
  await db.transaction('rw', db.assets, async () => {
    for (const a of assets) {
      await db.assets.put(a);
      if (!objectUrls.has(a.hash)) objectUrls.set(a.hash, URL.createObjectURL(a.blob));
    }
  });
  catalog.set(nextCatalog);
  worlds.set(nextWorlds);
  activeWorldId.set(nextWorlds[0]?.id ?? null);
  selectedCellId.set(null);
  selectedLinkId.set(null);
  clearChecked();
  await persistNow();
}

export async function resetDraft(): Promise<void> {
  await db.drafts.clear();
  await db.assets.clear();
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  objectUrls.clear();
  catalog.set(emptyCatalog());
  worlds.set([]);
  activeWorldId.set(null);
  selectedCellId.set(null);
  selectedLinkId.set(null);
  clearChecked();
}

/** Remove all resources, NPC types, icons, and their markers — keep worlds/areas/cells. */
export function clearTaxonomy(): void {
  catalog.set(emptyCatalog());
  worlds.update((ws) => ws.map((w) => ({ ...w, cells: w.cells.map((c) => ({ ...c, markers: [] })) })));
  clearChecked();
  schedulePersist();
}

// --------------------------------------------------------------------------
// Multi-select (bulk deletes)
// --------------------------------------------------------------------------
export function setMultiSelect(on: boolean): void {
  multiSelect.set(on);
  clearChecked();
}

export function clearChecked(): void {
  if (get(checkedIds).size) checkedIds.set(new Set());
}

export function toggleChecked(id: Id, on = !get(checkedIds).has(id)): void {
  checkedIds.update((s) => {
    const next = new Set(s);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  });
}

export function uncheck(ids: Iterable<Id>): void {
  checkedIds.update((s) => {
    const next = new Set(s);
    for (const id of ids) next.delete(id);
    return next;
  });
}

/** Multi-select click on a cell: toggles its tick and, when ticked, opens it in the inspector. */
export function toggleCellChecked(id: Id): void {
  const on = !get(checkedIds).has(id);
  toggleChecked(id, on);
  if (on) selectedCellId.set(id);
  else if (get(selectedCellId) === id) selectedCellId.set(null);
}

// --------------------------------------------------------------------------
// Worlds
// --------------------------------------------------------------------------
export function addWorld(name: string): Id {
  const id = newId('wld');
  const world: World = {
    schemaVersion: SCHEMA_VERSION,
    id,
    slug: uniqueSlug(name, get(worlds).map((w) => w.slug)),
    name,
    view: { minZoom: -6, maxZoom: 4, fitAll: true },
    config: { searchRespectsReveal: true, declutter: { enabled: false, hideMarkersBelowZoom: null } },
    areas: [],
    cells: [],
    connections: [],
  };
  worlds.update((ws) => [...ws, world]);
  activeWorldId.set(id);
  schedulePersist();
  return id;
}

export function renameWorld(id: Id, name: string): void {
  worlds.update((ws) => ws.map((w) => (w.id === id ? { ...w, name } : w)));
  schedulePersist();
}

/** Marker diameter (px) for the active world; players see the same size. */
export function setMarkerSize(px: number): void {
  const markerSize = Math.min(MARKER_SIZE_MAX, Math.max(MARKER_SIZE_MIN, Math.round(px)));
  updateActiveWorld((w) => ({ ...w, view: { ...w.view, markerSize } }));
}

export function deleteWorld(id: Id): void {
  worlds.update((ws) => ws.filter((w) => w.id !== id));
  if (get(activeWorldId) === id) {
    activeWorldId.set(get(worlds)[0]?.id ?? null);
    selectedCellId.set(null);
    selectedLinkId.set(null);
    clearChecked();
  }
  schedulePersist();
}

export function setActiveWorld(id: Id): void {
  activeWorldId.set(id);
  selectedCellId.set(null);
  selectedLinkId.set(null);
  clearChecked();
}

// --------------------------------------------------------------------------
// Areas
// --------------------------------------------------------------------------
export function addArea(name: string): Id | null {
  const w = activeWorld();
  if (!w) return null;
  const id = newId('area');
  updateActiveWorld((world) => ({
    ...world,
    areas: [...world.areas, { id, name, order: world.areas.length }],
  }));
  return id;
}
export function renameArea(id: Id, name: string): void {
  updateActiveWorld((w) => ({
    ...w,
    areas: w.areas.map((a) => (a.id === id ? { ...a, name } : a)),
  }));
}
/** Delete areas; their cells are kept and become unassigned. */
export function deleteAreas(ids: Id[]): void {
  const gone = new Set(ids);
  updateActiveWorld((w) => ({
    ...w,
    areas: w.areas.filter((a) => !gone.has(a.id)),
    cells: w.cells.map((c) => (c.areaId && gone.has(c.areaId) ? { ...c, areaId: null } : c)),
  }));
  uncheck(ids);
}
export function deleteArea(id: Id): void {
  deleteAreas([id]);
}

// --------------------------------------------------------------------------
// Cells
// --------------------------------------------------------------------------
export async function addCellFromFile(file: File, centerWorld: Vec2): Promise<void> {
  const w = activeWorld();
  if (!w) {
    editorToast.set('Create or select a world first.');
    return;
  }
  if (!isRasterImage(file)) {
    editorToast.set('Only PNG, JPG, WebP or GIF images are allowed (SVG is blocked for safety).');
    return;
  }
  const mime = file.type || 'image/png';
  const ext = extFromMime(mime);
  const hash = await hashBlob(file);
  const size = await imageSize(file);
  if (!objectUrls.has(hash)) {
    const asset: AssetBlob = { hash, mime, naturalSize: size, ext, blob: file };
    await db.assets.put(asset);
    objectUrls.set(hash, URL.createObjectURL(file));
  }
  // Scale the tile to a sensible on-map size (~800 world units on its long edge).
  const scale = 800 / Math.max(size[0], size[1]);
  const worldSize: Vec2 = [size[0] * scale, size[1] * scale];
  const cell: Cell = {
    id: newId('cell'),
    name: file.name.replace(/\.[^.]+$/, '') || 'New cell',
    areaId: w.areas[0]?.id ?? null,
    order: w.cells.length,
    image: { src: `assets/${w.id}/img/${hash}.${ext}`, hash, mime, naturalSize: size },
    geometry: { corners: cornersFromCenter(centerWorld, worldSize, 0), z: w.cells.length, opacity: 1 },
    hidden: false,
    defaultReveal: { resources: true, npcs: true },
    unlock: { keywords: [] },
    markers: [],
  };
  updateActiveWorld((world) => ({ ...world, cells: [...world.cells, cell] }));
  selectedCellId.set(cell.id);
}

export function updateCellGeometry(cellId: Id, corners: [Vec2, Vec2, Vec2, Vec2]): void {
  updateActiveWorld((w) => ({
    ...w,
    cells: w.cells.map((c) => (c.id === cellId ? { ...c, geometry: { ...c.geometry, corners } } : c)),
  }));
}

export function updateCell(cellId: Id, patch: Partial<Cell>): void {
  updateActiveWorld((w) => ({
    ...w,
    cells: w.cells.map((c) => (c.id === cellId ? { ...c, ...patch } : c)),
  }));
}

/** Player-facing note for a cell; blank removes it. */
export function setCellNote(cellId: Id, text: string): void {
  const note = text.trim();
  updateActiveWorld((w) => ({
    ...w,
    cells: w.cells.map((c) => {
      if (c.id !== cellId) return c;
      const { note: _drop, ...rest } = c;
      return note ? { ...rest, note } : rest;
    }),
  }));
}

export function deleteCells(ids: Id[]): void {
  const gone = new Set(ids);
  updateActiveWorld((w) => ({
    ...w,
    cells: w.cells.filter((c) => !gone.has(c.id)),
    // A connection can't outlive either of its cells.
    connections: (w.connections ?? []).filter((l) => !gone.has(l.from.cellId) && !gone.has(l.to.cellId)),
  }));
  const link = get(selectedLinkId);
  if (link && !activeWorld()?.connections?.some((l) => l.id === link)) selectedLinkId.set(null);
  const sel = get(selectedCellId);
  if (sel && gone.has(sel)) selectedCellId.set(null);
  uncheck(ids);
}
export function deleteCell(cellId: Id): void {
  deleteCells([cellId]);
}

// --------------------------------------------------------------------------
// Markers
// --------------------------------------------------------------------------
export function addMarkerAtWorldPoint(worldPos: Vec2): void {
  const mode = get(editMode);
  if (mode.kind !== 'place') return;
  const w = activeWorld();
  if (!w) return;
  const cell = topCellAt(w, worldPos);
  if (!cell) {
    editorToast.set('Click on a tile to place a marker.');
    return;
  }
  const uv = invBilinearAffine(cell.geometry.corners, worldPos);
  const marker: Marker = {
    id: newId('mrk'),
    kind: mode.markerKind,
    refId: mode.refId,
    uv,
  };
  updateActiveWorld((w) => ({
    ...w,
    cells: w.cells.map((c) => (c.id === cell.id ? { ...c, markers: [...c.markers, marker] } : c)),
  }));
}

/** Jump target for one marker (world + cell); null removes it. */
export function setMarkerLink(cellId: Id, markerId: Id, link: MarkerLink | null): void {
  updateActiveWorld((w) => ({
    ...w,
    cells: w.cells.map((c) =>
      c.id === cellId
        ? {
            ...c,
            markers: c.markers.map((m) => {
              if (m.id !== markerId) return m;
              const { link: _drop, ...rest } = m;
              return link ? { ...rest, link: { worldId: link.worldId, cellId: link.cellId } } : rest;
            }),
          }
        : c,
    ),
  }));
}

/** Custom display name for one marker ("CAVE 1"); blank removes it (the type name shows again). */
export function setMarkerName(cellId: Id, markerId: Id, name: string): void {
  const nameOverride = name.trim();
  updateActiveWorld((w) => ({
    ...w,
    cells: w.cells.map((c) =>
      c.id === cellId
        ? {
            ...c,
            markers: c.markers.map((m) => {
              if (m.id !== markerId) return m;
              const { nameOverride: _drop, ...rest } = m;
              return nameOverride ? { ...rest, nameOverride } : rest;
            }),
          }
        : c,
    ),
  }));
}

/** Per-marker size override in px; null removes it (marker follows the world size again). */
export function setMarkerSizeOverride(cellId: Id, markerId: Id, px: number | null): void {
  const size = px === null ? undefined : Math.min(MARKER_SIZE_MAX, Math.max(MARKER_SIZE_MIN, Math.round(px)));
  updateActiveWorld((w) => ({
    ...w,
    cells: w.cells.map((c) =>
      c.id === cellId
        ? {
            ...c,
            markers: c.markers.map((m) => {
              if (m.id !== markerId) return m;
              const { size: _drop, ...rest } = m;
              return size === undefined ? rest : { ...rest, size };
            }),
          }
        : c,
    ),
  }));
}

export function deleteMarkers(cellId: Id, ids: Id[]): void {
  const gone = new Set(ids);
  updateActiveWorld((w) => ({
    ...w,
    cells: w.cells.map((c) =>
      c.id === cellId ? { ...c, markers: c.markers.filter((m) => !gone.has(m.id)) } : c,
    ),
  }));
  uncheck(ids);
}
export function deleteMarker(cellId: Id, markerId: Id): void {
  deleteMarkers(cellId, [markerId]);
}

// --------------------------------------------------------------------------
// Connections (drawn links between cells)
// --------------------------------------------------------------------------
/** Connect mode click: the first click on a tile fixes the start, the second (on another tile) creates the link. */
export function connectAtWorldPoint(worldPos: Vec2): void {
  const mode = get(editMode);
  if (mode.kind !== 'connect') return;
  const w = activeWorld();
  if (!w) return;
  const cell = topCellAt(w, worldPos);
  if (!cell) {
    editorToast.set('Click on a tile.');
    return;
  }
  const end: ConnectionEnd = { cellId: cell.id, uv: clampUv(invBilinearAffine(cell.geometry.corners, worldPos)) };
  if (!mode.from) {
    editMode.set({ kind: 'connect', from: end });
    return;
  }
  if (mode.from.cellId === cell.id) {
    editorToast.set('Pick a point on a different tile for the other end.');
    return;
  }
  const from = mode.from;
  const link: Connection = { id: newId('lnk'), from, to: end };
  updateActiveWorld((world) => ({ ...world, connections: [...(world.connections ?? []), link] }));
  editMode.set({ kind: 'connect', from: null });
  const fromName = w.cells.find((c) => c.id === from.cellId)?.name ?? 'cell';
  editorToast.set(`Connected ${fromName} → ${cell.name}. Click a tile to start another, or Done.`);
}

/** Set or clear (empty string) the midpoint label. */
export function setConnectionLabel(id: Id, label: string): void {
  const text = label.trim();
  updateActiveWorld((w) => ({
    ...w,
    connections: (w.connections ?? []).map((l) => {
      if (l.id !== id) return l;
      const { label: _drop, ...rest } = l;
      return text ? { ...rest, label: text } : rest;
    }),
  }));
}

export function deleteConnections(ids: Id[]): void {
  const gone = new Set(ids);
  updateActiveWorld((w) => ({ ...w, connections: (w.connections ?? []).filter((l) => !gone.has(l.id)) }));
  if (gone.has(get(selectedLinkId) ?? '')) selectedLinkId.set(null);
  uncheck(ids);
}
export function deleteConnection(id: Id): void {
  deleteConnections([id]);
}

/** Select a connection for editing on the map (clears any selected cell). */
export function selectLink(id: Id | null): void {
  if (id) selectedCellId.set(null);
  selectedLinkId.set(id);
}

function updateConnection(id: Id, fn: (l: Connection) => Connection): void {
  updateActiveWorld((w) => ({ ...w, connections: (w.connections ?? []).map((l) => (l.id === id ? fn(l) : l)) }));
}

/**
 * Drop an end at a world point: it re-anchors to whichever tile is under the point.
 * Returns false (and leaves the link unchanged) when there is no tile, or it is the
 * other end's tile.
 */
export function moveConnectionEnd(id: Id, which: 'from' | 'to', worldPos: Vec2): boolean {
  const w = activeWorld();
  const link = w?.connections?.find((l) => l.id === id);
  if (!w || !link) return false;
  const cell = topCellAt(w, worldPos);
  if (!cell) {
    editorToast.set('Drop the end on a tile.');
    return false;
  }
  if (cell.id === (which === 'from' ? link.to : link.from).cellId) {
    editorToast.set('Both ends of a connection can’t be on the same tile.');
    return false;
  }
  const end: ConnectionEnd = { cellId: cell.id, uv: clampUv(invBilinearAffine(cell.geometry.corners, worldPos)) };
  updateConnection(id, (l) => ({ ...l, [which]: end }));
  return true;
}

/** Replace the bend points (world units); an empty list straightens the line. */
export function setConnectionVia(id: Id, via: Vec2[]): void {
  updateConnection(id, (l) => {
    const { via: _drop, ...rest } = l;
    return via.length ? { ...rest, via: via.map((p): Vec2 => [p[0], p[1]]) } : rest;
  });
}

export function insertConnectionVia(id: Id, index: number, at: Vec2): void {
  const link = activeWorld()?.connections?.find((l) => l.id === id);
  if (!link) return;
  const via = (link.via ?? []).slice();
  via.splice(index, 0, [at[0], at[1]]);
  setConnectionVia(id, via);
}

function clampUv(uv: Vec2): Vec2 {
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  return [clamp(uv[0]), clamp(uv[1])];
}

// --------------------------------------------------------------------------
// Taxonomy
// --------------------------------------------------------------------------
const LEAF_PREFIX: Record<TaxKind, IdPrefix> = { resource: 'res', location: 'loc', enemy: 'enm' };

/** Add a group (type/subtype) or a leaf to one forest, at the root or under `parentId`. */
export function addTaxNode(forest: TaxKind, parentId: Id | null, kind: 'group' | 'resource', name: string): Id {
  const id = newId(kind === 'resource' ? LEAF_PREFIX[forest] : parentId ? 'sub' : 'type');
  const field = TAX_FIELD[forest];
  updateCatalog((c) => {
    const nodes = forestOf(c, forest);
    if (!parentId) {
      const node: TaxNode = { id, name, order: nodes.length, kind };
      return { ...c, [field]: [...nodes, node] };
    }
    return {
      ...c,
      [field]: mapTaxTree(nodes, parentId, (parent) => {
        const children = parent.children ?? [];
        return { ...parent, children: [...children, { id, name, order: children.length, kind }] };
      }),
    };
  });
  return id;
}

/** Apply a forest transform to every forest (ids are unique, so this is safe and simple). */
function mapForests(c: Catalog, fn: (nodes: TaxNode[]) => TaxNode[]): Catalog {
  return { ...c, resources: fn(c.resources), locations: fn(c.locations ?? []), enemies: fn(c.enemies ?? []) };
}

export function renameTaxNode(id: Id, name: string): void {
  updateCatalog((c) => mapForests(c, (nodes) => mapTaxTree(nodes, id, (n) => ({ ...n, name }))));
}

/** Delete taxonomy nodes (any forest); a group takes its whole subtree with it. */
export function deleteTaxNodes(ids: Id[]): void {
  const gone = new Set(ids);
  updateCatalog((c) => mapForests(c, (nodes) => removeTaxNodes(nodes, gone)));
  uncheck(ids);
}
export function deleteTaxNode(id: Id): void {
  deleteTaxNodes([id]);
}

export function addNpcType(name: string): Id {
  const id = newId('npct');
  updateCatalog((c) => ({ ...c, npcTypes: [...c.npcTypes, { id, name, order: c.npcTypes.length }] }));
  return id;
}
export function renameNpcType(id: Id, name: string): void {
  updateCatalog((c) => ({
    ...c,
    npcTypes: c.npcTypes.map((t) => (t.id === id ? { ...t, name } : t)),
  }));
}
export function deleteNpcTypes(ids: Id[]): void {
  const gone = new Set(ids);
  updateCatalog((c) => ({ ...c, npcTypes: c.npcTypes.filter((t) => !gone.has(t.id)) }));
  uncheck(ids);
}
export function deleteNpcType(id: Id): void {
  deleteNpcTypes([id]);
}

/** Set an emoji icon on a resource/subtype/type node or an NPC type. */
export function setTaxIcon(id: Id, emoji: string): void {
  if (!emoji) return;
  const iconId = `ic_${id}`;
  updateCatalog((c) => assignIcon(c, id, iconId, { type: 'emoji', value: emoji }));
}

/** Set a CUSTOM IMAGE icon (uploaded file), stored content-addressed like a tile. */
export async function setTaxIconImage(id: Id, file: File): Promise<void> {
  if (!isRasterImage(file)) {
    editorToast.set('Icon must be a PNG, JPG, WebP or GIF (SVG is blocked for safety).');
    return;
  }
  const mime = file.type || 'image/png';
  const ext = extFromMime(mime);
  const hash = await hashBlob(file);
  let size: Vec2 = [16, 16];
  try {
    size = await imageSize(file);
  } catch {
    /* keep default */
  }
  if (!objectUrls.has(hash)) {
    await db.assets.put({ hash, mime, naturalSize: size, ext, blob: file });
    objectUrls.set(hash, URL.createObjectURL(file));
  }
  const iconId = `ic_${id}`;
  const value = `assets/icons/${hash}.${ext}`;
  updateCatalog((c) => assignIcon(c, id, iconId, { type: 'img', value }));
}

/** Resolve an img-icon's committed path to a renderable URL in the editor (object URL by hash). */
export function iconImgUrl(value: string): string {
  const hash = /([0-9a-f]+)\.[a-z0-9]+$/i.exec(value)?.[1];
  return (hash && objectUrls.get(hash)) || value;
}

function assignIcon(c: Catalog, id: Id, iconId: Id, icon: Catalog['icons'][string]): Catalog {
  const withIcon = { ...c, icons: { ...c.icons, [iconId]: icon } };
  const inForest = TAX_KINDS.some((k) => findTaxNode(forestOf(c, k), id));
  if (inForest) return mapForests(withIcon, (nodes) => mapTaxTree(nodes, id, (n) => ({ ...n, icon: iconId })));
  return { ...withIcon, npcTypes: c.npcTypes.map((t) => (t.id === id ? { ...t, icon: iconId } : t)) };
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------
function topCellAt(w: World, p: Vec2): Cell | null {
  const sorted = w.cells.slice().sort((a, b) => b.geometry.z - a.geometry.z);
  for (const c of sorted) {
    const uv = invBilinearAffine(c.geometry.corners, p);
    if (uv[0] >= 0 && uv[0] <= 1 && uv[1] >= 0 && uv[1] <= 1) return c;
  }
  return null;
}

export function findTaxNode(nodes: TaxNode[], id: Id): TaxNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const found = findTaxNode(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

function removeTaxNodes(nodes: TaxNode[], gone: ReadonlySet<Id>): TaxNode[] {
  return nodes
    .filter((n) => !gone.has(n.id))
    .map((n) => (n.children ? { ...n, children: removeTaxNodes(n.children, gone) } : n));
}

/** Immutably replace one node in the forest via `fn`, cloning the path to it. */
function mapTaxTree(nodes: TaxNode[], id: Id, fn: (n: TaxNode) => TaxNode): TaxNode[] {
  return nodes.map((n) => {
    if (n.id === id) return fn(n);
    if (n.children) return { ...n, children: mapTaxTree(n.children, id, fn) };
    return n;
  });
}

function uniqueSlug(name: string, existing: string[]): string {
  const base = slugify(name);
  if (!existing.includes(base)) return base;
  let i = 2;
  while (existing.includes(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function imageSize(blob: Blob): Promise<Vec2> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      resolve([img.naturalWidth, img.naturalHeight]);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image.'));
    };
    img.src = url;
  });
}
