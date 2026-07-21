// Taxonomy helpers — the operations that make the variable-depth type→subtype→
// resource tree "just work" for search. Pure; no Leaflet / DOM.

import type { Catalog, Icon, Id, NpcType, TaxNode } from './types';

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
 * All resource-leaf ids at or beneath `node`:
 * - a resource → [its own id]
 * - a group    → every resource in its subtree (incl. resources sitting directly
 *   under a type with no subtype, e.g. "Berry" under "Plant").
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

/** Every resource-leaf id in the whole catalog forest. */
export function allResourceIds(catalog: Catalog): Id[] {
  const out: Id[] = [];
  walkTax(catalog.resources, (n) => {
    if (n.kind === 'resource') out.push(n.id);
  });
  return out;
}

/** Index for O(1) lookups: id → node, id → ancestor path (root-first, excl. self). */
export interface TaxIndex {
  byId: Map<Id, TaxNode>;
  pathById: Map<Id, TaxNode[]>;
  resourceIds: Set<Id>;
}

export function indexTaxonomy(catalog: Catalog): TaxIndex {
  const byId = new Map<Id, TaxNode>();
  const pathById = new Map<Id, TaxNode[]>();
  const resourceIds = new Set<Id>();
  walkTax(catalog.resources, (n, path) => {
    byId.set(n.id, n);
    pathById.set(n.id, path);
    if (n.kind === 'resource') resourceIds.add(n.id);
  });
  return { byId, pathById, resourceIds };
}

/** Resolve a display name for a resource/NPC-type id, or a fallback. */
export function resolveResourceName(
  index: TaxIndex,
  id: Id | null,
  fallback = 'Unknown',
): string {
  if (!id) return fallback;
  return index.byId.get(id)?.name ?? fallback;
}

/**
 * Resolve an icon id for a resource, walking up ancestors if the leaf has none
 * (a resource → its subtype → its type). Returns the icon id or undefined.
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
