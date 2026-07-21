// Pure search logic (rules S1–S5). No Leaflet / DOM — unit-testable.
//
//  S1  visible = revealGate AND searchGate   (reveal arrives in Phase 2)
//  S2  per-kind independence; "solo" = disable every other resource
//  S3  selecting a group toggles all descendant resources (handled in the tree UI
//      via subtreeResourceIds); parent checkbox state is DERIVED here
//  S4  scoped to the active world only (index is built from the loaded world)
//  S5  search never reveals — it can only narrow what reveal already permits
//
// In-memory search state uses Sets (fast membership); player-state persistence
// stores the equivalent arrays (see state/playerState.ts).

import type { Cell, Id, Marker, World } from '../model/types';
import { subtreeResourceIds } from '../model/taxonomy';

/** In-memory search selection. Empty sets ⇒ everything visible (the default). */
export interface SearchState {
  disabledResourceIds: Set<Id>;
  disabledNpcTypeIds: Set<Id>;
  excludedAreaIds: Set<Id>;
}

export function emptySearchState(): SearchState {
  return {
    disabledResourceIds: new Set(),
    disabledNpcTypeIds: new Set(),
    excludedAreaIds: new Set(),
  };
}

// --------------------------------------------------------------------------
// Per-world index: what actually exists in the loaded world (for greying empty
// branches and showing counts). Built once per world load (S4 isolation).
// --------------------------------------------------------------------------
export interface WorldSearchIndex {
  presentResourceIds: Set<Id>;
  presentNpcTypeIds: Set<Id>;
  resourceCounts: Map<Id, number>;
  npcTypeCounts: Map<Id, number>;
  untypedNpcCount: number;
}

export function buildWorldSearchIndex(world: World): WorldSearchIndex {
  const presentResourceIds = new Set<Id>();
  const presentNpcTypeIds = new Set<Id>();
  const resourceCounts = new Map<Id, number>();
  const npcTypeCounts = new Map<Id, number>();
  let untypedNpcCount = 0;

  for (const cell of world.cells) {
    for (const m of cell.markers) {
      if (m.kind === 'resource' && m.refId) {
        presentResourceIds.add(m.refId);
        resourceCounts.set(m.refId, (resourceCounts.get(m.refId) ?? 0) + 1);
      } else if (m.kind === 'npc') {
        if (m.refId) {
          presentNpcTypeIds.add(m.refId);
          npcTypeCounts.set(m.refId, (npcTypeCounts.get(m.refId) ?? 0) + 1);
        } else {
          untypedNpcCount++;
        }
      }
    }
  }
  return {
    presentResourceIds,
    presentNpcTypeIds,
    resourceCounts,
    npcTypeCounts,
    untypedNpcCount,
  };
}

// --------------------------------------------------------------------------
// The gate (S2). A marker's "area" is its cell's areaId.
// --------------------------------------------------------------------------
export function searchGate(marker: Marker, cell: Cell, search: SearchState): boolean {
  // Area filter applies to both kinds (S2). areaId null = unassigned, never excluded.
  if (cell.areaId !== null && search.excludedAreaIds.has(cell.areaId)) return false;

  if (marker.kind === 'resource') {
    // A resource marker with no ref shouldn't exist post-validation; treat as filtered.
    return marker.refId !== null && !search.disabledResourceIds.has(marker.refId);
  }
  // NPC: untyped NPCs (refId null) have no type to filter on — always pass the
  // type filter (they render, but aren't targetable by NPC search). S2 note.
  return marker.refId === null || !search.disabledNpcTypeIds.has(marker.refId);
}

// --------------------------------------------------------------------------
// Tri-state derivation for the search tree (S3). Computed over the resources
// that are actually PRESENT in the world, so empty branches don't skew it.
// --------------------------------------------------------------------------
export type CheckState = 'on' | 'off' | 'mixed' | 'empty';

export function nodeCheckState(
  subtreeResIds: Id[],
  disabled: Set<Id>,
  present: Set<Id>,
): CheckState {
  const relevant = subtreeResIds.filter((id) => present.has(id));
  if (relevant.length === 0) return 'empty';
  let on = 0;
  let off = 0;
  for (const id of relevant) {
    if (disabled.has(id)) off++;
    else on++;
  }
  if (off === 0) return 'on';
  if (on === 0) return 'off';
  return 'mixed';
}

/** Re-export so the tree UI resolves a node → its resource leaves in one place. */
export { subtreeResourceIds };
