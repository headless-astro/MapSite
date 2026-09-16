import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateCatalog, validateManifest, validateWorld } from './schema';
import { MARKER_SIZE_MAX, type Catalog } from './types';

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

  it('keeps a valid view.markerSize, clamps an out-of-range one and drops a non-number', () => {
    const withSize = (markerSize: unknown) =>
      validateWorld(
        {
          schemaVersion: 1,
          id: 'w',
          slug: 'w',
          name: 'W',
          view: { minZoom: -4, maxZoom: 4, markerSize },
          config: { searchRespectsReveal: true, declutter: { enabled: false, hideMarkersBelowZoom: null } },
          areas: [],
          cells: [baseCell({ areaId: null })],
        },
        catalog,
      );
    const ok = withSize(40);
    expect(ok.value.view.markerSize).toBe(40);
    expect(ok.warnings).toHaveLength(0);

    const big = withSize(500);
    expect(big.value.view.markerSize).toBe(MARKER_SIZE_MAX);
    expect(big.warnings).toHaveLength(1);

    const bad = withSize('huge');
    expect(bad.value.view.markerSize).toBeUndefined();
    expect(bad.warnings).toHaveLength(1);
  });

  it('sanitizes a per-marker size override the same way', () => {
    const raw = {
      schemaVersion: 1,
      id: 'w',
      slug: 'w',
      name: 'W',
      view: { minZoom: -4, maxZoom: 4 },
      config: { searchRespectsReveal: true, declutter: { enabled: false, hideMarkersBelowZoom: null } },
      areas: [],
      cells: [
        baseCell({
          areaId: null,
          markers: [
            { id: 'fine', kind: 'resource', refId: 'res_berry', uv: [0.5, 0.5], size: 40 },
            { id: 'big', kind: 'resource', refId: 'res_berry', uv: [0.5, 0.5], size: 500 },
            { id: 'junk', kind: 'resource', refId: 'res_berry', uv: [0.5, 0.5], size: 'xl' },
          ],
        }),
      ],
    };
    const { value, warnings } = validateWorld(raw, catalog);
    const sizes = value.cells[0].markers.map((m) => m.size);
    expect(sizes).toEqual([40, MARKER_SIZE_MAX, undefined]);
    expect(warnings).toHaveLength(2);
  });

  it('keeps connections between real cells and drops broken ones', () => {
    const raw = {
      schemaVersion: 1,
      id: 'w',
      slug: 'w',
      name: 'W',
      view: { minZoom: -4, maxZoom: 4 },
      config: { searchRespectsReveal: true, declutter: { enabled: false, hideMarkersBelowZoom: null } },
      areas: [],
      cells: [baseCell({ id: 'a', areaId: null }), baseCell({ id: 'b', areaId: null })],
      connections: [
        { id: 'ok', from: { cellId: 'a', uv: [0.9, 1.7] }, to: { cellId: 'b', uv: [0.1, 0.5] }, label: ' door ' },
        { id: 'orphan', from: { cellId: 'a', uv: [0.5, 0.5] }, to: { cellId: 'zzz', uv: [0.5, 0.5] } },
        { id: 'self', from: { cellId: 'a', uv: [0.5, 0.5] }, to: { cellId: 'a', uv: [0.5, 0.5] } },
        { id: 'nouv', from: { cellId: 'b' }, to: { cellId: 'a', uv: 'x' } },
        {
          id: 'bent',
          from: { cellId: 'a', uv: [0.5, 0.5] },
          to: { cellId: 'b', uv: [0.5, 0.5] },
          via: [[10, 20], 'junk', [1, NaN], [30, 40]],
        },
      ],
    };
    const { value, warnings } = validateWorld(raw, catalog);
    expect(value.connections?.map((c) => c.id)).toEqual(['ok', 'nouv', 'bent']);
    expect(value.connections?.[0]).toEqual({
      id: 'ok',
      from: { cellId: 'a', uv: [0.9, 1] },
      to: { cellId: 'b', uv: [0.1, 0.5] },
      label: 'door',
    });
    expect(value.connections?.[1].from.uv).toEqual([0.5, 0.5]);
    expect(value.connections?.[2].via).toEqual([[10, 20], [30, 40]]);
    expect(warnings).toHaveLength(3);
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
