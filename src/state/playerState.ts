// Per-world player state, persisted to localStorage. This is the ONLY module
// that touches the `mapsite:v1:*` keys. The editor never reads or writes them —
// authored data lives in files, player choices live here (a clean boundary).
//
// Design notes:
//  - One JSON blob per world (`mapsite:v1:pstate:<worldId>`): synchronous first
//    paint, per-world isolation, atomic reset. Stores only EXCEPTIONS to authored
//    defaults, so it stays kilobyte-scale even at hundreds of cells.
//  - `v1` = storage-layout version (key namespace). `schemaVersion` = value shape.
//  - Writes are debounced and flushed on pagehide; all wrapped in try/catch so a
//    quota error / private mode degrades to an in-memory fallback, never a crash.

import type { Id, Vec2 } from '../model/types';

export const STORAGE_PREFIX = 'mapsite:v1';
export const PLAYER_STATE_VERSION = 1;

export interface PlayerState {
  schemaVersion: number;
  // Reveal exceptions vs authored defaults (populated in Phase 2).
  cellRevealResources: Record<Id, boolean>;
  cellRevealNpcs: Record<Id, boolean>;
  areaRevealHidden: Record<Id, true>;
  // Search selections (Phase 1). Empty ⇒ everything visible.
  search: {
    disabledResourceIds: Id[];
    disabledNpcTypeIds: Id[];
    excludedAreaIds: Id[];
  };
  view?: { center: Vec2; zoom: number };
  // Reserved: collected (Phase 5), unlockedCells (Phase 6).
}

export function defaultPlayerState(): PlayerState {
  return {
    schemaVersion: PLAYER_STATE_VERSION,
    cellRevealResources: {},
    cellRevealNpcs: {},
    areaRevealHidden: {},
    search: { disabledResourceIds: [], disabledNpcTypeIds: [], excludedAreaIds: [] },
  };
}

function key(worldId: Id): string {
  return `${STORAGE_PREFIX}:pstate:${worldId}`;
}

// In-memory fallback when localStorage is unavailable (private mode / quota).
const memory = new Map<string, string>();
let storageOk = true;

function rawGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    storageOk = false;
    return memory.get(k) ?? null;
  }
}

function rawSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    storageOk = false;
    memory.set(k, v);
  }
}

function rawRemove(k: string): void {
  try {
    localStorage.removeItem(k);
  } catch {
    memory.delete(k);
  }
}

/** Load a world's player state, repairing/migrating as needed. Never throws. */
export function loadPlayerState(worldId: Id): PlayerState {
  const raw = rawGet(key(worldId));
  if (!raw) return defaultPlayerState();
  try {
    const parsed = JSON.parse(raw) as Partial<PlayerState>;
    return migratePlayerState(parsed);
  } catch {
    // Player state is non-precious: discard a corrupt blob and start fresh.
    return defaultPlayerState();
  }
}

function migratePlayerState(p: Partial<PlayerState>): PlayerState {
  const base = defaultPlayerState();
  return {
    schemaVersion: PLAYER_STATE_VERSION,
    cellRevealResources: p.cellRevealResources ?? base.cellRevealResources,
    cellRevealNpcs: p.cellRevealNpcs ?? base.cellRevealNpcs,
    areaRevealHidden: p.areaRevealHidden ?? base.areaRevealHidden,
    search: {
      disabledResourceIds: p.search?.disabledResourceIds ?? [],
      disabledNpcTypeIds: p.search?.disabledNpcTypeIds ?? [],
      excludedAreaIds: p.search?.excludedAreaIds ?? [],
    },
    view: p.view,
  };
}

// --- Debounced writes ------------------------------------------------------
const pending = new Map<Id, PlayerState>();
let timer: ReturnType<typeof setTimeout> | null = null;

export function savePlayerState(worldId: Id, state: PlayerState, debounceMs = 400): void {
  pending.set(worldId, state);
  if (timer) clearTimeout(timer);
  timer = setTimeout(flushPlayerState, debounceMs);
}

/** Write any pending state immediately (also called on pagehide). */
export function flushPlayerState(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  for (const [worldId, state] of pending) {
    rawSet(key(worldId), JSON.stringify(state));
  }
  pending.clear();
}

export function resetPlayerState(worldId: Id): PlayerState {
  pending.delete(worldId);
  rawRemove(key(worldId));
  return defaultPlayerState();
}

export function isStorageHealthy(): boolean {
  return storageOk;
}

let handlersInstalled = false;
/** Attach flush-on-exit handlers once (call from app bootstrap). */
export function installFlushHandlers(): void {
  if (handlersInstalled || typeof window === 'undefined') return;
  handlersInstalled = true;
  const flush = () => flushPlayerState();
  window.addEventListener('pagehide', flush);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}
