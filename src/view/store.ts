// Application state for the viewer. Plain Svelte stores (DOM-free) so the map
// controller and the UI both react to the same source of truth. The store owns
// data + the search selection; viewApp bridges changes to the MapController.

import { derived, get, writable } from 'svelte/store';
import type {
  Catalog,
  Id,
  Manifest,
  MarkerLink,
  RevealKey,
  TaxKind,
  World,
  WorldRef,
} from '../model/types';
import { tileVisible } from '../logic/revealController';
import {
  buildWorldSearchIndex,
  DISABLED_KEY,
  emptySearchState,
  type SearchState,
  type WorldSearchIndex,
} from '../logic/searchController';
import {
  emptyRevealState,
  globalReveal as globalRevealPure,
  setAreaRevealHidden as setAreaHiddenPure,
  setCellReveal as setCellRevealPure,
  type RevealState,
} from '../logic/revealController';
import {
  flushPlayerState,
  loadPlayerState,
  resetPlayerState,
  savePlayerState,
  STORAGE_PREFIX,
  type PlayerState,
} from '../state/playerState';
import { loadCatalog, loadManifest, loadWorld } from './loaders';

export type Status = 'loading' | 'ready' | 'error';

export const status = writable<Status>('loading');
export const errorMsg = writable<string>('');
export const manifest = writable<Manifest | null>(null);
export const catalog = writable<Catalog | null>(null);
export const worldRef = writable<WorldRef | null>(null);
export const world = writable<World | null>(null);
export const worldIndex = writable<WorldSearchIndex | null>(null);
export const search = writable<SearchState>(emptySearchState());
export const reveal = writable<RevealState>(emptyRevealState());
export const warnings = writable<string[]>([]);
export const toast = writable<{ msg: string; error?: boolean } | null>(null);
/** The cell whose notes are open in the side panel (cleared when the world changes). */
export const selectedCellId = writable<Id | null>(null);
/** One-shot request for the map to center on a cell of the loaded world (after a jump). */
export const focusRequest = writable<{ cellId: Id; seq: number } | null>(null);
let focusSeq = 0;

/** Name of a world by id, from the manifest. */
export function worldName(worldId: Id): string {
  return get(manifest)?.worlds.find((w) => w.id === worldId)?.name ?? 'another world';
}

/** Follow a marker link: switch world if needed, then center on the target cell and open its notes. */
export async function jumpToLink(link: MarkerLink): Promise<void> {
  const m = get(manifest);
  if (!m?.worlds.some((w) => w.id === link.worldId)) {
    toast.set({ msg: 'That link points to a world that is not published.', error: true });
    return;
  }
  await selectWorld(link.worldId);
  const w = get(world);
  const cell = w?.cells.find((c) => c.id === link.cellId);
  if (!w || w.id !== link.worldId || !cell) {
    toast.set({ msg: 'That link points to a cell that no longer exists.', error: true });
    return;
  }
  focusRequest.set({ cellId: cell.id, seq: ++focusSeq });
  selectedCellId.set(cell.id);
  if (!tileVisible(cell, get(reveal))) {
    toast.set({ msg: `${cell.name} is a hidden location. Reveal its area to show it.` });
  } else {
    toast.set({ msg: `${cell.name} · ${w.name}` });
  }
}

// Global (not per-world) display preferences, persisted separately.
export interface DisplayPrefs {
  cellLabels: boolean;
  areaRegions: boolean;
  connections: boolean;
}
const DISPLAY_KEY = `${STORAGE_PREFIX}:display`;

function loadDisplayPrefs(): DisplayPrefs {
  try {
    const raw = localStorage.getItem(DISPLAY_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<DisplayPrefs>;
      return {
        cellLabels: p.cellLabels ?? true,
        areaRegions: p.areaRegions ?? true,
        connections: p.connections ?? true,
      };
    }
  } catch {
    // ignore (private mode / corrupt) → defaults
  }
  return { cellLabels: true, areaRegions: true, connections: true };
}

export const displayPrefs = writable<DisplayPrefs>(loadDisplayPrefs());

export function setDisplayPref(key: keyof DisplayPrefs, value: boolean): void {
  displayPrefs.update((p) => {
    const next = { ...p, [key]: value };
    try {
      localStorage.setItem(DISPLAY_KEY, JSON.stringify(next));
    } catch {
      // ignore write failures
    }
    return next;
  });
}

/** Combined stream the map subscribes to (world change vs search/reveal change). */
export const renderState = derived(
  [world, catalog, search, reveal],
  ([$world, $catalog, $search, $reveal]) => ({
    world: $world,
    catalog: $catalog,
    search: $search,
    reveal: $reveal,
  }),
);

// Module-scoped mutable state kept alongside the stores.
let currentWorldId: Id | null = null;
let currentPlayerState: PlayerState | null = null;

// -------------------------------------------------------------------------
// Boot
// -------------------------------------------------------------------------
export async function initApp(): Promise<void> {
  status.set('loading');
  errorMsg.set('');
  try {
    const m = await loadManifest();
    manifest.set(m.value);
    const c = await loadCatalog(m.value);
    catalog.set(c.value);
    warnings.set([...m.warnings, ...c.warnings]);

    const startId = worldIdFromHash(m.value) ?? m.value.worlds[0]?.id ?? null;
    if (!startId) throw new Error('index.json defines no worlds.');
    await selectWorld(startId);
    status.set('ready');

    window.addEventListener('hashchange', onHashChange);
  } catch (e) {
    errorMsg.set((e as Error).message ?? String(e));
    status.set('error');
  }
}

// -------------------------------------------------------------------------
// World selection (per-world isolation: only the chosen world is loaded)
// -------------------------------------------------------------------------
export async function selectWorld(worldId: Id): Promise<void> {
  const m = get(manifest);
  const c = get(catalog);
  if (!m || !c) return;
  const ref = m.worlds.find((w) => w.id === worldId);
  if (!ref) {
    toast.set({ msg: `Unknown world: ${worldId}`, error: true });
    return;
  }
  if (worldId === currentWorldId) return;

  flushPlayerState(); // persist the world we're leaving

  try {
    const w = await loadWorld(ref.data, c);
    currentWorldId = worldId;
    currentPlayerState = loadPlayerState(worldId);

    worldRef.set(ref);
    selectedCellId.set(null);
    world.set(w.value);
    worldIndex.set(buildWorldSearchIndex(w.value));
    if (w.warnings.length) warnings.update((prev) => [...prev, ...w.warnings]);
    search.set(searchStateFromPlayer(currentPlayerState));
    reveal.set(revealStateFromPlayer(currentPlayerState));
    updateHash(ref.slug);
  } catch (e) {
    console.error('selectWorld failed', e);
    toast.set({ msg: (e as Error).message ?? String(e), error: true });
  }
}

// -------------------------------------------------------------------------
// Search mutations — each commits to both the store and player state.
// -------------------------------------------------------------------------
function commitSearch(next: SearchState): void {
  search.set(next);
  if (currentWorldId && currentPlayerState) {
    currentPlayerState.search = {
      disabledResourceIds: [...next.disabledResourceIds],
      disabledNpcTypeIds: [...next.disabledNpcTypeIds],
      disabledLocationIds: [...next.disabledLocationIds],
      disabledEnemyIds: [...next.disabledEnemyIds],
      excludedAreaIds: [...next.excludedAreaIds],
    };
    savePlayerState(currentWorldId, currentPlayerState);
  }
}

function cloneSearch(s: SearchState): SearchState {
  return {
    disabledResourceIds: new Set(s.disabledResourceIds),
    disabledNpcTypeIds: new Set(s.disabledNpcTypeIds),
    disabledLocationIds: new Set(s.disabledLocationIds),
    disabledEnemyIds: new Set(s.disabledEnemyIds),
    excludedAreaIds: new Set(s.excludedAreaIds),
  };
}

/** Enable/disable leaves of one forest (a leaf, or a group's subtree). */
export function setLeavesEnabled(kind: TaxKind, ids: Id[], enabled: boolean): void {
  const next = cloneSearch(get(search));
  const set = next[DISABLED_KEY[kind]];
  for (const id of ids) {
    if (enabled) set.delete(id);
    else set.add(id);
  }
  commitSearch(next);
}

/** Show only these leaves of one forest (disable every other PRESENT leaf of that kind). */
export function soloLeaves(kind: TaxKind, ids: Id[]): void {
  const idx = get(worldIndex);
  if (!idx) return;
  const keep = new Set(ids);
  const next = cloneSearch(get(search));
  const set = new Set<Id>();
  for (const present of idx.present[kind]) {
    if (!keep.has(present)) set.add(present);
  }
  next[DISABLED_KEY[kind]] = set;
  commitSearch(next);
}

export function setAllLeaves(kind: TaxKind, enabled: boolean): void {
  const idx = get(worldIndex);
  if (!idx) return;
  const next = cloneSearch(get(search));
  next[DISABLED_KEY[kind]] = enabled ? new Set() : new Set(idx.present[kind]);
  commitSearch(next);
}

export const setResourcesEnabled = (ids: Id[], enabled: boolean): void => setLeavesEnabled('resource', ids, enabled);
export const soloResources = (ids: Id[]): void => soloLeaves('resource', ids);
export const setAllResources = (enabled: boolean): void => setAllLeaves('resource', enabled);

export function setNpcTypeEnabled(id: Id, enabled: boolean): void {
  const next = cloneSearch(get(search));
  if (enabled) next.disabledNpcTypeIds.delete(id);
  else next.disabledNpcTypeIds.add(id);
  commitSearch(next);
}

export function setAllNpcTypes(enabled: boolean): void {
  const idx = get(worldIndex);
  if (!idx) return;
  const next = cloneSearch(get(search));
  next.disabledNpcTypeIds = enabled ? new Set() : new Set(idx.presentNpcTypeIds);
  commitSearch(next);
}

export function setAreaExcluded(id: Id, excluded: boolean): void {
  const next = cloneSearch(get(search));
  if (excluded) next.excludedAreaIds.add(id);
  else next.excludedAreaIds.delete(id);
  commitSearch(next);
}

export function resetSearch(): void {
  commitSearch(emptySearchState());
}

/** Wipe all local state for the current world and reload its defaults. */
export function resetWorld(): void {
  if (!currentWorldId) return;
  currentPlayerState = resetPlayerState(currentWorldId);
  search.set(searchStateFromPlayer(currentPlayerState));
  reveal.set(revealStateFromPlayer(currentPlayerState));
  toast.set({ msg: 'Local progress for this world was reset.' });
}

// -------------------------------------------------------------------------
// Reveal mutations (R1–R9). Each commits to the store and player state.
// -------------------------------------------------------------------------
function commitReveal(next: RevealState): void {
  reveal.set(next);
  if (currentWorldId && currentPlayerState) {
    currentPlayerState.cellRevealResources = Object.fromEntries(next.cellRevealResources);
    currentPlayerState.cellRevealNpcs = Object.fromEntries(next.cellRevealNpcs);
    currentPlayerState.cellRevealLocations = Object.fromEntries(next.cellRevealLocations);
    currentPlayerState.cellRevealEnemies = Object.fromEntries(next.cellRevealEnemies);
    currentPlayerState.areaRevealHidden = Object.fromEntries(
      [...next.areaRevealHidden].map((id) => [id, true as const]),
    );
    savePlayerState(currentWorldId, currentPlayerState);
  }
}

/** Toggle one cell's per-kind reveal (R3). */
export function setCellReveal(cellId: Id, kind: RevealKey, value: boolean): void {
  const w = get(world);
  const cell = w?.cells.find((c) => c.id === cellId);
  if (!cell) return;
  commitReveal(setCellRevealPure(get(reveal), cell, kind, value));
}

/** Per-area reveal-hidden toggle (R9, tiles-only). */
export function setAreaRevealHidden(areaId: Id, value: boolean): void {
  commitReveal(setAreaHiddenPure(get(reveal), areaId, value));
}

/** Global reveal sweep over currently-rendered cells (R5/R6). */
export function globalReveal(kind: RevealKey, desired: boolean): void {
  const w = get(world);
  if (!w) return;
  commitReveal(globalRevealPure(w, get(reveal), kind, desired));
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------
function searchStateFromPlayer(ps: PlayerState): SearchState {
  return {
    disabledResourceIds: new Set(ps.search.disabledResourceIds),
    disabledNpcTypeIds: new Set(ps.search.disabledNpcTypeIds),
    disabledLocationIds: new Set(ps.search.disabledLocationIds),
    disabledEnemyIds: new Set(ps.search.disabledEnemyIds),
    excludedAreaIds: new Set(ps.search.excludedAreaIds),
  };
}

function revealStateFromPlayer(ps: PlayerState): RevealState {
  return {
    cellRevealResources: new Map(Object.entries(ps.cellRevealResources)),
    cellRevealNpcs: new Map(Object.entries(ps.cellRevealNpcs)),
    cellRevealLocations: new Map(Object.entries(ps.cellRevealLocations)),
    cellRevealEnemies: new Map(Object.entries(ps.cellRevealEnemies)),
    areaRevealHidden: new Set(Object.keys(ps.areaRevealHidden)),
  };
}

function worldIdFromHash(m: Manifest): Id | null {
  const slug = parseHashSlug();
  if (!slug) return null;
  return m.worlds.find((w) => w.slug === slug)?.id ?? null;
}

function parseHashSlug(): string | null {
  const match = /^#\/w\/([^/?]+)/.exec(location.hash);
  return match ? decodeURIComponent(match[1]) : null;
}

function updateHash(slug: string): void {
  const target = `#/w/${slug}`;
  if (location.hash !== target) {
    history.replaceState(null, '', target);
  }
}

function onHashChange(): void {
  const m = get(manifest);
  if (!m) return;
  const id = worldIdFromHash(m);
  if (id && id !== currentWorldId) void selectWorld(id);
}
