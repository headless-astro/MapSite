import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateCatalog, validateManifest, validateWorld } from './schema';
import type { Catalog } from './types';

const catalog: Catalog = {
  schemaVersion: 1,
  resources: [
    {
      id: 'type_plant',
      name: 'Plant',
      order: 0,
      kind: 'group',
      children: [{ id: 'res_berry', name: 'Berry', order: 0, kind: 'resource' }],
    },
  ],
  npcTypes: [{ id: 'npct_merchant', name: 'Merchant', order: 0 }],
  icons: {},
};

function baseCell(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    name: 'Cell',
    areaId: 'area_a',
    order: 0,
    image: { src: 'x.png', hash: 'x', mime: 'image/png', naturalSize: [1, 1] },
    geometry: { corners: [[0, 0], [1, 0], [1, 1], [0, 1]], z: 0 },
    hidden: false,
    defaultReveal: { resources: true, npcs: true },
    markers: [],
    ...overrides,
  };
}

describe('validateWorld (defensive repair)', () => {
  it('drops markers with invalid refs but keeps valid ones and null NPC refs', () => {
    const raw = {
      schemaVersion: 1,
      id: 'w',
      slug: 'w',
      name: 'W',
      view: { minZoom: -4, maxZoom: 4 },
      config: { searchRespectsReveal: true, declutter: { enabled: false, hideMarkersBelowZoom: null } },
      areas: [{ id: 'area_a', name: 'A', order: 0 }],
      cells: [
        baseCell({
          markers: [
            { id: 'ok', kind: 'resource', refId: 'res_berry', uv: [0.5, 0.5] },
            { id: 'bad', kind: 'resource', refId: 'res_nope', uv: [0.5, 0.5] },
            { id: 'nullnpc', kind: 'npc', refId: null, uv: [0.5, 0.5] },
            { id: 'badnpc', kind: 'npc', refId: 'npct_nope', uv: [0.5, 0.5] },
          ],
        }),
      ],
    };
    const { value, warnings } = validateWorld(raw, catalog);
    const kept = value.cells[0].markers.map((m) => m.id);
    expect(kept).toEqual(['ok', 'nullnpc']);
    expect(warnings.length).toBe(2);
  });

  it('unassigns a cell that references a missing area (does not drop the cell)', () => {
    const raw = {
      schemaVersion: 1,
      id: 'w',
      slug: 'w',
      name: 'W',
      view: { minZoom: -4, maxZoom: 4 },
      config: { searchRespectsReveal: true, declutter: { enabled: false, hideMarkersBelowZoom: null } },
      areas: [{ id: 'area_a', name: 'A', order: 0 }],
      cells: [baseCell({ id: 'orphan', areaId: 'area_missing' })],
    };
    const { value, warnings } = validateWorld(raw, catalog);
    expect(value.cells).toHaveLength(1);
    expect(value.cells[0].areaId).toBeNull();
    expect(warnings.some((w) => w.includes('missing area'))).toBe(true);
  });

  it('cascades area defaultReveal to a cell that lacks its own', () => {
    const raw = {
      schemaVersion: 1,
      id: 'w',
      slug: 'w',
      name: 'W',
      view: { minZoom: -4, maxZoom: 4 },
      config: { searchRespectsReveal: true, declutter: { enabled: false, hideMarkersBelowZoom: null } },
      areas: [{ id: 'area_a', name: 'A', order: 0, defaultReveal: { resources: false, npcs: false } }],
      cells: [baseCell({ defaultReveal: undefined })],
    };
    const { value } = validateWorld(raw, catalog);
    expect(value.cells[0].defaultReveal).toEqual({ resources: false, npcs: false });
  });
});

describe('validateCatalog / validateManifest', () => {
  it('warns when a resource node carries children', () => {
    const raw = {
      schemaVersion: 1,
      resources: [
        {
          id: 'r',
          name: 'R',
          order: 0,
          kind: 'resource',
          children: [{ id: 'x', name: 'X', order: 0, kind: 'resource' }],
        },
      ],
      npcTypes: [],
      icons: {},
    };
    const { warnings } = validateCatalog(raw);
    expect(warnings.some((w) => w.includes('has children'))).toBe(true);
  });

  it('throws on a malformed manifest', () => {
    expect(() => validateManifest({ nope: true })).toThrow();
  });
});

describe('the committed sample data validates cleanly', () => {
  const read = (p: string) => JSON.parse(readFileSync(join(process.cwd(), p), 'utf8'));

  it('manifest + catalog + every world load without warnings', () => {
    const manifest = validateManifest(read('public/data/index.json'));
    expect(manifest.warnings).toHaveLength(0);

    const cat = validateCatalog(read('public/data/catalog.json'));
    expect(cat.warnings).toHaveLength(0);

    for (const ref of manifest.value.worlds) {
      const w = validateWorld(read(join('public/data', ref.data)), cat.value);
      expect(w.warnings, `world ${ref.id} should have no warnings`).toHaveLength(0);
      expect(w.value.cells.length).toBeGreaterThan(0);
    }
  });
});
