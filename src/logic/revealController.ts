// Pure reveal/spoiler rules (R1–R9). No Leaflet / DOM — unit-testable.
//
//  R1 tile renders iff !hidden OR areaRevealHidden[areaId]
//  R2 a marker is never shown while its tile isn't rendered
//  R3 per-cell, per-kind reveal (resources / npcs / locations / enemies are
//     independent), vs authored default
//  R4 author marker.hidden wins (never shown)
//  R5 global reveal = imperative sweep over CURRENTLY-RENDERED cells only —
//     hidden/un-revealed cells are excluded, so unlocking a hidden area later
//     shows its tiles with markers at authored defaults (hidden ⇒ stay hidden =
//     "tiles only"). This is what prevents the spoiler leak.
//  R6 global overwrites individual (for rendered cells)
//  R7 global button state is tri-state, DERIVED over rendered cells
//  R9 reveal-hidden is strictly per-area, tiles-only
//
// Combined with search: visible = revealGate AND searchGate (S1), and search
// never reveals (S5) unless world.config.searchRespectsReveal is false.
//
// In-memory reveal state uses Maps/Set; player-state persistence stores the
// equivalent Records/arrays (see state/playerState.ts). Stored values are only
// EXCEPTIONS to authored defaults, so state stays tiny.

import { REVEAL_KEY } from '../model/types';
import type { Cell, Id, Marker, RevealKey, World } from '../model/types';
import { searchGate, type SearchState } from './searchController';

export interface RevealState {
  cellRevealResources: Map<Id, boolean>;
  cellRevealNpcs: Map<Id, boolean>;
  cellRevealLocations: Map<Id, boolean>;
  cellRevealEnemies: Map<Id, boolean>;
  areaRevealHidden: Set<Id>;
}

/** The per-cell exception map for a reveal key. */
export function revealMap(r: RevealState, key: RevealKey): Map<Id, boolean> {
  switch (key) {
    case 'resources':
      return r.cellRevealResources;
    case 'npcs':
      return r.cellRevealNpcs;
    case 'locations':
      return r.cellRevealLocations;
    case 'enemies':
      return r.cellRevealEnemies;
  }
}

export function emptyRevealState(): RevealState {
  return {
    cellRevealResources: new Map(),
    cellRevealNpcs: new Map(),
    cellRevealLocations: new Map(),
    cellRevealEnemies: new Map(),
    areaRevealHidden: new Set(),
  };
}

export function cloneReveal(r: RevealState): RevealState {
  return {
    cellRevealResources: new Map(r.cellRevealResources),
    cellRevealNpcs: new Map(r.cellRevealNpcs),
    cellRevealLocations: new Map(r.cellRevealLocations),
    cellRevealEnemies: new Map(r.cellRevealEnemies),
    areaRevealHidden: new Set(r.areaRevealHidden),
  };
}

/** Authored default for a kind; a key the author never set means "revealed". */
export function revealDefault(cell: Cell, key: RevealKey): boolean {
  return cell.defaultReveal[key] ?? true;
}

function effective(map: Map<Id, boolean>, cellId: Id, dflt: boolean): boolean {
  const v = map.get(cellId);
  return v === undefined ? dflt : v;
}

// --- R1 ---
export function tileVisible(cell: Cell, reveal: RevealState): boolean {
  if (!cell.hidden) return true;
  return cell.areaId !== null && reveal.areaRevealHidden.has(cell.areaId);
}

// --- R3 per-kind eligibility (independent of the tile gate) ---
export function cellReveals(cell: Cell, reveal: RevealState, key: RevealKey): boolean {
  return effective(revealMap(reveal, key), cell.id, revealDefault(cell, key));
}
export function cellRevealsResources(cell: Cell, reveal: RevealState): boolean {
  return cellReveals(cell, reveal, 'resources');
}
export function cellRevealsNpcs(cell: Cell, reveal: RevealState): boolean {
  return cellReveals(cell, reveal, 'npcs');
}

// --- R2 + R3 + R4: is this marker allowed to show (before search)? ---
export function markerRevealed(marker: Marker, cell: Cell, reveal: RevealState): boolean {
  if (marker.hidden) return false; // R4
  if (!tileVisible(cell, reveal)) return false; // R2 (needs R1)
  return cellReveals(cell, reveal, REVEAL_KEY[marker.kind]);
}

// --- S1 + S5: full visibility (reveal AND search) ---
export function markerVisible(
  marker: Marker,
  cell: Cell,
  reveal: RevealState,
  search: SearchState,
  world: World,
): boolean {
  if (!searchGate(marker, cell, search)) return false;
  if (world.config.searchRespectsReveal) return markerRevealed(marker, cell, reveal);
  // Sandbox world: search alone decides — but the tile must still render (R1)
  // and an author-hidden marker still never shows (R4).
  return !marker.hidden && tileVisible(cell, reveal);
}

// --- R5 + R6: sweep a kind over currently-rendered cells → new state ---
export function globalReveal(
  world: World,
  reveal: RevealState,
  kind: RevealKey,
  desired: boolean,
): RevealState {
  const next = cloneReveal(reveal);
  const map = revealMap(next, kind);
  for (const cell of world.cells) {
    if (!tileVisible(cell, reveal)) continue; // rendered-only (R5): no leak
    const dflt = revealDefault(cell, kind);
    if (desired === dflt) map.delete(cell.id);
    else map.set(cell.id, desired);
  }
  return next;
}

// --- R7: tri-state over rendered cells for a kind ---
export type Tri = 'on' | 'off' | 'mixed' | 'none';
export function globalTriState(
  world: World,
  reveal: RevealState,
  kind: RevealKey,
): Tri {
  let on = 0;
  let off = 0;
  for (const cell of world.cells) {
    if (!tileVisible(cell, reveal)) continue;
    if (cellReveals(cell, reveal, kind)) on++;
    else off++;
  }
  if (on === 0 && off === 0) return 'none';
  if (off === 0) return 'on';
  if (on === 0) return 'off';
  return 'mixed';
}

// --- set a single cell's per-kind reveal (stores only an exception vs default) ---
export function setCellReveal(
  reveal: RevealState,
  cell: Cell,
  kind: RevealKey,
  value: boolean,
): RevealState {
  const next = cloneReveal(reveal);
  const map = revealMap(next, kind);
  if (value === revealDefault(cell, kind)) map.delete(cell.id);
  else map.set(cell.id, value);
  return next;
}

// --- R9: per-area reveal-hidden (tiles only; markers keep authored defaults) ---
export function setAreaRevealHidden(
  reveal: RevealState,
  areaId: Id,
  value: boolean,
): RevealState {
  const next = cloneReveal(reveal);
  if (value) next.areaRevealHidden.add(areaId);
  else next.areaRevealHidden.delete(areaId);
  return next;
}

/** Does an area contain any hidden cells (so a "reveal hidden" control applies)? */
export function areaHasHidden(world: World, areaId: Id): boolean {
  return world.cells.some((c) => c.areaId === areaId && c.hidden);
}
