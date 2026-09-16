// Taxonomy helpers — the operations that make the variable-depth type→subtype→
// leaf forests (resources, locations, enemies) "just work" for search. Pure; no
// Leaflet / DOM. Node ids are unique across the three forests, so one index
// serves them all and callers only need the id.

import { TAX_FIELD, TAX_KINDS } from './types';
import type { Catalog, Icon, Id, NpcType, TaxKind, TaxNode } from './types';

/** The forest for a kind (missing field → empty). */
export function forestOf(catalog: Catalog, kind: TaxKind): TaxNode[] {
  return catalog[TAX_FIELD[kind]] ?? [];
}

/** Depth-first walk over a forest; `visit` receives each node and its ancestor path. */
export function walkTax(
  nodes: TaxNode[],
  visit: (node: TaxNode, path: TaxNode[]) => void,
  path: TaxNode[] = [],
): void {
  for (const n of nodes) {
    visit(n, path);
    if (n.children && n.children.length) walkTax(n.children, visit, [...path, n]);
  }
}

/**
 * All leaf ids at or beneath `node`:
 * - a leaf  → [its own id]
 * - a group → every leaf in its subtree (incl. leaves sitting directly under a
 *   type with no subtype, e.g. "Berry" under "Plant").
 * This is what a search-tree selection resolves to, at ANY depth.
 */
export function subtreeResourceIds(node: TaxNode): Id[] {
  const out: Id[] = [];
  const rec = (n: TaxNode) => {
    if (n.kind === 'resource') out.push(n.id);
    if (n.children) for (const c of n.children) rec(c);
  };
  rec(node);
  return out;
}

/** Every leaf id in one forest of the catalog. */
export function allLeafIds(catalog: Catalog, kind: TaxKind): Id[] {
  const out: Id[] = [];
  walkTax(forestOf(catalog, kind), (n) => {
    if (n.kind === 'resource') out.push(n.id);
  });
  return out;
}

/** Every resource-leaf id in the catalog (kept for callers that only know resources). */
export function allResourceIds(catalog: Catalog): Id[] {
  return allLeafIds(catalog, 'resource');
}

/** Index for O(1) lookups across all forests: id → node, id → ancestor path, id → forest. */
export interface TaxIndex {
  byId: Map<Id, TaxNode>;
  pathById: Map<Id, TaxNode[]>;
  /** Which forest a node belongs to. */
  kindOf: Map<Id, TaxKind>;
  /** Leaf ids per forest. */
  leafIds: Record<TaxKind, Set<Id>>;
  /** Alias of leafIds.resource. */
  resourceIds: Set<Id>;
}

export function indexTaxonomy(catalog: Catalog): TaxIndex {
  const byId = new Map<Id, TaxNode>();
  const pathById = new Map<Id, TaxNode[]>();
  const kindOf = new Map<Id, TaxKind>();
  const leafIds: Record<TaxKind, Set<Id>> = { resource: new Set(), location: new Set(), enemy: new Set() };
  for (const kind of TAX_KINDS) {
    walkTax(forestOf(catalog, kind), (n, path) => {
      byId.set(n.id, n);
      pathById.set(n.id, path);
      kindOf.set(n.id, kind);
      if (n.kind === 'resource') leafIds[kind].add(n.id);
    });
  }
  return { byId, pathById, kindOf, leafIds, resourceIds: leafIds.resource };
}

/** Resolve a display name for a taxonomy node id (any forest), or a fallback. */
export function resolveResourceName(
  index: TaxIndex,
  id: Id | null,
  fallback = 'Unknown',
): string {
  if (!id) return fallback;
  return index.byId.get(id)?.name ?? fallback;
}

/**
 * Resolve an icon id for a taxonomy node, walking up ancestors if the leaf has
 * none (a leaf → its subtype → its type). Returns the icon id or undefined.
 */
export function resolveResourceIconId(
  index: TaxIndex,
  id: Id | null,
): Id | undefined {
  if (!id) return undefined;
  const node = index.byId.get(id);
  if (node?.icon) return node.icon;
  const path = index.pathById.get(id) ?? [];
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].icon) return path[i].icon;
  }
  return undefined;
}

/** Look up an Icon definition by id from the shared catalog. */
export function getIcon(catalog: Catalog, iconId: Id | undefined): Icon | undefined {
  return iconId ? catalog.icons[iconId] : undefined;
}

export function npcTypeName(
  catalog: Catalog,
  id: Id | null,
  fallback = 'NPC',
): string {
  if (!id) return fallback;
  return catalog.npcTypes.find((t: NpcType) => t.id === id)?.name ?? fallback;
}
