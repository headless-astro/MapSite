import { describe, expect, it } from 'vitest';
import {
  cloneReveal,
  emptyRevealState,
  globalReveal,
  globalTriState,
  markerRevealed,
  markerVisible,
  setAreaRevealHidden,
  setCellReveal,
  tileVisible,
} from './revealController';
import { emptySearchState } from './searchController';
import type { Cell, Marker, World } from '../model/types';

function marker(id: string, kind: 'resource' | 'npc', extra: Partial<Marker> = {}): Marker {
  return { id, kind, refId: kind === 'resource' ? 'res_x' : 'npct_x', uv: [0.5, 0.5], ...extra };
}
function cell(
  id: string,
  areaId: string | null,
  hidden: boolean,
  defaultReveal: { resources: boolean; npcs: boolean },
  markers: Marker[],
): Cell {
  return {
    id, name: id, areaId, order: 0,
    image: { src: '', hash: '', mime: 'image/png', naturalSize: [1, 1] },
    geometry: { corners: [[0, 0], [1, 0], [1, 1], [0, 1]], z: 0 },
    hidden, defaultReveal, markers,
  };
}

const cOpen = cell('c_open', 'a1', false, { resources: true, npcs: true }, [
  marker('m_or', 'resource'), marker('m_on', 'npc'),
]);
const cSecret = cell('c_secret', 'a1', true, { resources: false, npcs: false }, [
  marker('m_sr', 'resource'),
]);
const cHushed = cell('c_hushed', 'a2', false, { resources: false, npcs: true }, [
  marker('m_hr', 'resource'), marker('m_hn', 'npc'),
]);
const world: World = {
  schemaVersion: 1, id: 'w', slug: 'w', name: 'W',
  view: { minZoom: -4, maxZoom: 4 },
  config: { searchRespectsReveal: true, declutter: { enabled: false, hideMarkersBelowZoom: null } },
  areas: [
    { id: 'a1', name: 'A1', order: 0 },
    { id: 'a2', name: 'A2', order: 1 },
  ],
  cells: [cOpen, cSecret, cHushed],
};

describe('R1 tileVisible', () => {
  it('non-hidden always renders; hidden only when its area is revealed', () => {
    const r = emptyRevealState();
    expect(tileVisible(cOpen, r)).toBe(true);
    expect(tileVisible(cSecret, r)).toBe(false);
    const revealed = setAreaRevealHidden(r, 'a1', true);
    expect(tileVisible(cSecret, revealed)).toBe(true);
  });
});

describe('R2/R3/R4 markerRevealed', () => {
  it('respects authored per-kind defaults', () => {
    const r = emptyRevealState();
    expect(markerRevealed(cOpen.markers[0], cOpen, r)).toBe(true); // resources default true
    expect(markerRevealed(cHushed.markers[0], cHushed, r)).toBe(false); // resources default false
    expect(markerRevealed(cHushed.markers[1], cHushed, r)).toBe(true); // npcs default true
  });
  it('R2: a marker on an un-rendered hidden tile is never shown', () => {
    const r = emptyRevealState();
    expect(markerRevealed(cSecret.markers[0], cSecret, r)).toBe(false);
  });
  it('R4: author-hidden marker never shows even when revealed', () => {
    const hiddenM = marker('m_x', 'resource', { hidden: true });
    const c = cell('c', 'a1', false, { resources: true, npcs: true }, [hiddenM]);
    expect(markerRevealed(hiddenM, c, emptyRevealState())).toBe(false);
  });
  it('a per-cell exception overrides the default', () => {
    const r = setCellReveal(emptyRevealState(), cHushed, 'resources', true);
    expect(markerRevealed(cHushed.markers[0], cHushed, r)).toBe(true);
    expect(r.cellRevealResources.get('c_hushed')).toBe(true); // stored as exception
    // Re-setting back to the default clears the exception (minimal storage).
    const r2 = setCellReveal(r, cHushed, 'resources', false);
    expect(r2.cellRevealResources.has('c_hushed')).toBe(false);
  });
});

describe('R5/R6 global sweep — rendered cells only (no spoiler leak)', () => {
  it('reveals rendered cells but does NOT touch an un-revealed hidden cell', () => {
    const r = globalReveal(world, emptyRevealState(), 'resources', true);
    // rendered cells got revealed:
    expect(markerRevealed(cOpen.markers[0], cOpen, r)).toBe(true);
    expect(markerRevealed(cHushed.markers[0], cHushed, r)).toBe(true);
    // the hidden secret cell was skipped (not rendered at sweep time):
    expect(r.cellRevealResources.has('c_secret')).toBe(false);

    // THE BLOCKER: now reveal the secret's area — its tile shows, but its
    // markers must remain hidden (tiles-only), NOT auto-revealed by the sweep.
    const r2 = setAreaRevealHidden(r, 'a1', true);
    expect(tileVisible(cSecret, r2)).toBe(true);
    expect(markerRevealed(cSecret.markers[0], cSecret, r2)).toBe(false);
  });

  it('global OFF hides all rendered cells', () => {
    const r = globalReveal(world, emptyRevealState(), 'resources', false);
    expect(markerRevealed(cOpen.markers[0], cOpen, r)).toBe(false);
    expect(markerRevealed(cHushed.markers[0], cHushed, r)).toBe(false);
  });
});

describe('R7 globalTriState over rendered cells', () => {
  it('derives on/off/mixed and none', () => {
    // default: c_open resources on, c_hushed resources off → mixed
    expect(globalTriState(world, emptyRevealState(), 'resources')).toBe('mixed');
    // after global ON → on
    expect(globalTriState(world, globalReveal(world, emptyRevealState(), 'resources', true), 'resources')).toBe('on');
    // after global OFF → off
    expect(globalTriState(world, globalReveal(world, emptyRevealState(), 'resources', false), 'resources')).toBe('off');
    // npcs: c_open on, c_hushed on, secret not rendered → on
    expect(globalTriState(world, emptyRevealState(), 'npcs')).toBe('on');
    // a world where nothing is rendered → none
    const allHidden: World = { ...world, cells: [cSecret] };
    expect(globalTriState(allHidden, emptyRevealState(), 'resources')).toBe('none');
  });
});

describe('S1/S5 markerVisible combines reveal and search', () => {
  const search = emptySearchState();
  it('respects reveal by default (search cannot surface un-revealed markers)', () => {
    expect(markerVisible(cHushed.markers[0], cHushed, emptyRevealState(), search, world)).toBe(false);
  });
  it('with searchRespectsReveal=false, search alone decides among rendered tiles', () => {
    const sandbox: World = { ...world, config: { ...world.config, searchRespectsReveal: false } };
    // hushed resource is default-hidden, but sandbox surfaces it (tile is rendered):
    expect(markerVisible(cHushed.markers[0], cHushed, emptyRevealState(), search, sandbox)).toBe(true);
    // still cannot surface a marker on an un-rendered hidden tile (R1):
    expect(markerVisible(cSecret.markers[0], cSecret, emptyRevealState(), search, sandbox)).toBe(false);
  });
  it('clone is a deep copy', () => {
    const r = emptyRevealState();
    const c = cloneReveal(r);
    c.areaRevealHidden.add('a1');
    expect(r.areaRevealHidden.has('a1')).toBe(false);
  });
});
