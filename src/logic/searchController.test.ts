import { describe, expect, it } from 'vitest';
import {
  buildWorldSearchIndex,
  emptySearchState,
  nodeCheckState,
  searchGate,
  subtreeResourceIds,
  type SearchState,
} from './searchController';
import type { Cell, Marker, TaxNode, World } from '../model/types';

function cell(id: string, areaId: string | null, markers: Marker[]): Cell {
  return {
    id,
    name: id,
    areaId,
    order: 0,
    image: { src: '', hash: '', mime: 'image/png', naturalSize: [1, 1] },
    geometry: { corners: [[0, 0], [1, 0], [1, 1], [0, 1]], z: 0 },
    hidden: false,
    defaultReveal: { resources: true, npcs: true },
    markers,
  };
}
function res(id: string, refId: string | null): Marker {
  return { id, kind: 'resource', refId, uv: [0.5, 0.5] };
}
function npc(id: string, refId: string | null): Marker {
  return { id, kind: 'npc', refId, uv: [0.5, 0.5] };
}

const world: World = {
  schemaVersion: 1,
  id: 'w',
  slug: 'w',
  name: 'W',
  view: { minZoom: -4, maxZoom: 4 },
  config: { searchRespectsReveal: true, declutter: { enabled: false, hideMarkersBelowZoom: null } },
  areas: [
    { id: 'area_a', name: 'A', order: 0 },
    { id: 'area_b', name: 'B', order: 1 },
  ],
  cells: [
    cell('c1', 'area_a', [res('m1', 'res_berry'), res('m2', 'res_berry'), npc('m3', 'npct_merchant')]),
    cell('c2', 'area_b', [res('m4', 'res_iron'), npc('m5', null)]),
  ],
};

describe('buildWorldSearchIndex', () => {
  it('counts present resources, npc types, and untyped npcs (per world)', () => {
    const idx = buildWorldSearchIndex(world);
    expect(idx.presentResourceIds).toEqual(new Set(['res_berry', 'res_iron']));
    expect(idx.resourceCounts.get('res_berry')).toBe(2);
    expect(idx.presentNpcTypeIds).toEqual(new Set(['npct_merchant']));
    expect(idx.untypedNpcCount).toBe(1);
  });
});

describe('searchGate (S2)', () => {
  const c1 = world.cells[0];
  const c2 = world.cells[1];
  it('passes everything with an empty state', () => {
    const s = emptySearchState();
    expect(searchGate(res('m1', 'res_berry'), c1, s)).toBe(true);
    expect(searchGate(npc('m5', null), c2, s)).toBe(true);
  });
  it('hides a disabled resource but not others', () => {
    const s: SearchState = { ...emptySearchState(), disabledResourceIds: new Set(['res_berry']) };
    expect(searchGate(res('m1', 'res_berry'), c1, s)).toBe(false);
    expect(searchGate(res('m4', 'res_iron'), c2, s)).toBe(true);
  });
  it('excludes a whole area for both kinds', () => {
    const s: SearchState = { ...emptySearchState(), excludedAreaIds: new Set(['area_a']) };
    expect(searchGate(res('m1', 'res_berry'), c1, s)).toBe(false);
    expect(searchGate(npc('m3', 'npct_merchant'), c1, s)).toBe(false);
    expect(searchGate(res('m4', 'res_iron'), c2, s)).toBe(true);
  });
  it('untyped NPCs ignore the type filter but obey area exclusion', () => {
    const disabled: SearchState = { ...emptySearchState(), disabledNpcTypeIds: new Set(['npct_merchant']) };
    expect(searchGate(npc('m5', null), c2, disabled)).toBe(true); // no type → unaffected
    expect(searchGate(npc('m3', 'npct_merchant'), c1, disabled)).toBe(false);
    const excl: SearchState = { ...emptySearchState(), excludedAreaIds: new Set(['area_b']) };
    expect(searchGate(npc('m5', null), c2, excl)).toBe(false);
  });
});

describe('nodeCheckState (S3, over present resources only)', () => {
  const group: TaxNode = {
    id: 'g',
    name: 'g',
    order: 0,
    kind: 'group',
    children: [
      { id: 'res_berry', name: 'Berry', order: 0, kind: 'resource' },
      { id: 'res_iron', name: 'Iron', order: 1, kind: 'resource' },
      { id: 'res_absent', name: 'Absent', order: 2, kind: 'resource' },
    ],
  };
  const present = new Set(['res_berry', 'res_iron']); // res_absent has no markers
  const leaves = subtreeResourceIds(group);

  it('is "on" when nothing present is disabled', () => {
    expect(nodeCheckState(leaves, new Set(), present)).toBe('on');
  });
  it('is "off" when all present are disabled', () => {
    expect(nodeCheckState(leaves, new Set(['res_berry', 'res_iron']), present)).toBe('off');
  });
  it('is "mixed" when some present are disabled', () => {
    expect(nodeCheckState(leaves, new Set(['res_berry']), present)).toBe('mixed');
  });
  it('is "empty" when no present resources fall under the node', () => {
    expect(nodeCheckState(leaves, new Set(), new Set())).toBe('empty');
    // absent-only subtree
    expect(nodeCheckState(['res_absent'], new Set(), present)).toBe('empty');
  });
});
