// Validation & migration for committed data. Because there is no backend, the
// viewer is the only guard against a malformed hand-edit or a stale export — so
// validation is DEFENSIVE: it repairs what it safely can (dropping orphaned
// references, unassigning cells from missing areas) and reports warnings rather
// than crashing the map. It throws only when a document is fundamentally
// unusable (not an object / missing required arrays).

import { MARKER_SIZE_MAX, MARKER_SIZE_MIN, SCHEMA_VERSION } from './types';
import type { Catalog, Cell, Manifest, Marker, TaxNode, World } from './types';
import { indexTaxonomy } from './taxonomy';

export interface ValidationResult<T> {
  value: T;
  warnings: string[];
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkVersion(kind: string, v: unknown, warnings: string[]): void {
  const n = typeof v === 'number' ? v : 0;
  if (n > SCHEMA_VERSION) {
    warnings.push(
      `${kind} schemaVersion ${n} is newer than this app supports (${SCHEMA_VERSION}); rendering may be incomplete.`,
    );
  }
  // n < SCHEMA_VERSION would run migrations here (none defined yet).
}

// --------------------------------------------------------------------------
// Manifest
// --------------------------------------------------------------------------
export function validateManifest(raw: unknown): ValidationResult<Manifest> {
  if (!isObj(raw) || !Array.isArray(raw.worlds)) {
    throw new Error('index.json is malformed: expected an object with a "worlds" array.');
  }
  const warnings: string[] = [];
  checkVersion('Manifest', raw.schemaVersion, warnings);
  return { value: raw as unknown as Manifest, warnings };
}

// --------------------------------------------------------------------------
// Catalog
// --------------------------------------------------------------------------
export function validateCatalog(raw: unknown): ValidationResult<Catalog> {
  if (!isObj(raw) || !Array.isArray(raw.resources)) {
    throw new Error('catalog.json is malformed: expected an object with a "resources" array.');
  }
  const warnings: string[] = [];
  checkVersion('Catalog', raw.schemaVersion, warnings);
  const catalog = raw as unknown as Catalog;
  if (!Array.isArray(catalog.npcTypes)) catalog.npcTypes = [];
  if (!catalog.icons || typeof catalog.icons !== 'object') catalog.icons = {};

  // Defense-in-depth: constrain icons so a hand-edited catalog can't smuggle a
  // bad type/value/color into the render layer. `value` is still escaped at
  // render; a non-hex `color` (CSS-injection vector) is dropped here.
  for (const [id, icon] of Object.entries(catalog.icons)) {
    if (!icon || (icon.type !== 'emoji' && icon.type !== 'img') || typeof icon.value !== 'string') {
      delete catalog.icons[id];
      warnings.push(`Dropped malformed icon "${id}".`);
      continue;
    }
    if (icon.color && !/^#[0-9a-fA-F]{3,8}$/.test(icon.color)) {
      delete icon.color;
      warnings.push(`Dropped invalid color on icon "${id}".`);
    }
  }

  // Warn about resource nodes that carry children (should be groups instead).
  const flagChildrenOnResource = (nodes: TaxNode[]) => {
    for (const n of nodes) {
      if (n.kind === 'resource' && n.children && n.children.length) {
        warnings.push(
          `Resource "${n.name}" (${n.id}) has children; children of a resource are ignored in search.`,
        );
      }
      if (n.children) flagChildrenOnResource(n.children);
    }
  };
  flagChildrenOnResource(catalog.resources);
  return { value: catalog, warnings };
}

// --------------------------------------------------------------------------
// World (validated against an already-validated catalog)
// --------------------------------------------------------------------------
export function validateWorld(
  raw: unknown,
  catalog: Catalog,
): ValidationResult<World> {
  if (!isObj(raw) || !Array.isArray(raw.cells) || !Array.isArray(raw.areas)) {
    throw new Error('world file is malformed: expected "areas" and "cells" arrays.');
  }
  const warnings: string[] = [];
  checkVersion('World', raw.schemaVersion, warnings);
  const world = raw as unknown as World;

  // Fill sensible defaults for optional config so downstream code is simple.
  world.config ??= { searchRespectsReveal: true, declutter: { enabled: false, hideMarkersBelowZoom: null } };
  world.config.searchRespectsReveal ??= true;
  world.config.declutter ??= { enabled: false, hideMarkersBelowZoom: null };
  world.view ??= { minZoom: -5, maxZoom: 5, fitAll: true };

  // Marker size: a hand-edit must not be able to make markers vanish or blanket the map.
  world.view.markerSize = sanitizeMarkerSize(world.view.markerSize, 'view.markerSize', warnings);
  if (world.view.markerSize === undefined) delete world.view.markerSize;

  const areaIds = new Set(world.areas.map((a) => a.id));
  const tax = indexTaxonomy(catalog);
  const npcTypeIds = new Set(catalog.npcTypes.map((t) => t.id));

  for (const cell of world.cells as Cell[]) {
    // Cell → missing area: unassign (don't drop the whole cell) + warn.
    if (cell.areaId !== null && !areaIds.has(cell.areaId)) {
      warnings.push(
        `Cell "${cell.name}" (${cell.id}) references missing area ${cell.areaId}; unassigned.`,
      );
      cell.areaId = null;
    }
    // Apply area-level defaultReveal cascade where the cell didn't set its own.
    const area = cell.areaId ? world.areas.find((a) => a.id === cell.areaId) : undefined;
    if (!cell.defaultReveal) {
      cell.defaultReveal = area?.defaultReveal
        ? { ...area.defaultReveal }
        : { resources: true, npcs: true };
    }
    if (typeof cell.hidden !== 'boolean') {
      cell.hidden = area?.hidden ?? false;
    }

    // Marker → invalid ref: drop marker + warn.
    const kept: Marker[] = [];
    for (const m of cell.markers ?? []) {
      if (m.kind === 'resource') {
        if (m.refId && tax.resourceIds.has(m.refId)) {
          kept.push(m);
        } else {
          warnings.push(
            `Resource marker ${m.id} on cell ${cell.id} has invalid resource ref ${m.refId}; dropped.`,
          );
        }
      } else {
        // NPC markers may have refId === null (unique untyped NPC).
        if (m.refId === null || npcTypeIds.has(m.refId)) {
          kept.push(m);
        } else {
          warnings.push(
            `NPC marker ${m.id} on cell ${cell.id} has invalid npcType ref ${m.refId}; dropped.`,
          );
        }
      }
    }
    for (const m of kept) {
      if (m.size === undefined) continue;
      m.size = sanitizeMarkerSize(m.size, `marker ${m.id} size`, warnings);
      if (m.size === undefined) delete m.size;
    }
    cell.markers = kept;
  }

  return { value: world, warnings };
}

/** A usable px size, or undefined (with a warning) when the value can't be used. */
function sanitizeMarkerSize(value: unknown, what: string, warnings: string[]): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    warnings.push(`Ignored ${what} ${JSON.stringify(value)}; expected a number of pixels.`);
    return undefined;
  }
  if (value < MARKER_SIZE_MIN || value > MARKER_SIZE_MAX) {
    const clamped = Math.min(MARKER_SIZE_MAX, Math.max(MARKER_SIZE_MIN, value));
    warnings.push(`${what} ${value} is outside ${MARKER_SIZE_MIN}–${MARKER_SIZE_MAX}; clamped to ${clamped}.`);
    return clamped;
  }
  return value;
}
