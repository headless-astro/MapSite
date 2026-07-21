import { describe, expect, it } from 'vitest';
import {
  allResourceIds,
  indexTaxonomy,
  resolveResourceIconId,
  resolveResourceName,
  subtreeResourceIds,
} from './taxonomy';
import type { Catalog, TaxNode } from './types';

// "Berry" sits DIRECTLY under a type (no subtype); "Crab Leg" is two levels deep.
const plant: TaxNode = {
  id: 'type_plant',
  name: 'Plant',
  order: 0,
  kind: 'group',
  icon: 'ic_plant',
  children: [{ id: 'res_berry', name: 'Berry', order: 0, kind: 'resource' }],
};
const animal: TaxNode = {
  id: 'type_animal',
  name: 'Animal',
  order: 1,
  kind: 'group',
  children: [
    {
      id: 'sub_fishing',
      name: 'Fishing',
      order: 0,
      kind: 'group',
      children: [
        { id: 'res_crableg', name: 'Crab Leg', order: 0, kind: 'resource', icon: 'ic_crab' },
        { id: 'res_fish', name: 'Fish', order: 1, kind: 'resource' },
      ],
    },
  ],
};
const catalog: Catalog = {
  schemaVersion: 1,
  resources: [plant, animal],
  npcTypes: [],
  icons: {},
};

describe('subtreeResourceIds (variable depth)', () => {
  it('a resource resolves to itself', () => {
    expect(subtreeResourceIds(plant.children![0])).toEqual(['res_berry']);
  });
  it('a type resolves to a resource sitting directly under it', () => {
    expect(subtreeResourceIds(plant)).toEqual(['res_berry']);
  });
  it('a type resolves to ALL descendants across depths', () => {
    expect(subtreeResourceIds(animal).sort()).toEqual(['res_crableg', 'res_fish']);
  });
  it('a subtype resolves to its leaves', () => {
    expect(subtreeResourceIds(animal.children![0]).sort()).toEqual(['res_crableg', 'res_fish']);
  });
});

describe('allResourceIds / indexTaxonomy', () => {
  it('enumerates every resource leaf and only leaves', () => {
    expect(allResourceIds(catalog).sort()).toEqual(['res_berry', 'res_crableg', 'res_fish']);
    const idx = indexTaxonomy(catalog);
    expect(idx.resourceIds.has('res_berry')).toBe(true);
    expect(idx.resourceIds.has('type_plant')).toBe(false);
    expect(idx.pathById.get('res_crableg')?.map((n) => n.id)).toEqual([
      'type_animal',
      'sub_fishing',
    ]);
  });
});

describe('name / icon resolution', () => {
  it('resolves names by id', () => {
    const idx = indexTaxonomy(catalog);
    expect(resolveResourceName(idx, 'res_crableg')).toBe('Crab Leg');
    expect(resolveResourceName(idx, null)).toBe('Unknown');
  });
  it('walks up ancestors for an icon when the leaf has none', () => {
    const idx = indexTaxonomy(catalog);
    // Berry has no icon → inherits Plant's icon.
    expect(resolveResourceIconId(idx, 'res_berry')).toBe('ic_plant');
    // Crab Leg has its own icon.
    expect(resolveResourceIconId(idx, 'res_crableg')).toBe('ic_crab');
  });
});
