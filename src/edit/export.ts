// Export the draft as a ZIP whose contents are the exact committed layout, ready
// to drop into public/ and open a PR. JSON is serialized with sorted keys so
// diffs stay small and merges stay clean (the collaboration model is PR review).

import { strToU8, zipSync } from 'fflate';
import { get } from 'svelte/store';
import type { Catalog, TaxNode, World } from '../model/types';
import { catalog as catalogStore, worlds as worldsStore, persistNow } from './draftStore';
import { db } from './db';

// Sort id-bearing arrays so independent additions from two contributors land at
// DIFFERENT positions in the file (by id) instead of all appending to the same
// last line — which lets Git auto-merge most non-overlapping edits. Array order
// is cosmetic here (the app sorts by the `order` field and looks up by id).
function byId<T extends { id: string }>(arr: T[]): T[] {
  return arr.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
function canonTax(nodes: TaxNode[]): TaxNode[] {
  return byId(nodes).map((n) => (n.children ? { ...n, children: canonTax(n.children) } : n));
}
function canonCatalog(c: Catalog): Catalog {
  return {
    ...c,
    resources: canonTax(c.resources),
    locations: canonTax(c.locations ?? []),
    enemies: canonTax(c.enemies ?? []),
    npcTypes: byId(c.npcTypes),
  };
}
function canonWorld(w: World): World {
  return {
    ...w,
    areas: byId(w.areas),
    connections: byId(w.connections ?? []),
    cells: byId(w.cells).map((c) => ({ ...c, markers: byId(c.markers) })),
  };
}

const README = `This ZIP mirrors the repository's SOURCE layout.

To publish your changes:
1. In the repository ROOT, DELETE the old  data-src/  and  public/assets/  folders.
   (Unzipping only adds/overwrites files, so anything you deleted in the editor
   would otherwise survive as a leftover file and come back on the next build.)
2. Unzip this file into the repository ROOT. It recreates:
     data-src/        (the map data you edited — one small file per cell)
     public/assets/   (tile & icon images still in use)
3. Optional local check: run  npm run build:data  and open the player view.
4. Create a branch, commit the changes (git add -A data-src public/assets),
   and open a Pull Request.
5. The maintainer reviews and merges; the site rebuilds automatically.

Why per-cell files: you edit data-src/worlds/<world>/cells/<cell>.json, so two
people editing different cells never conflict in Git.

Do NOT edit public/data/ — it is GENERATED from data-src/ at build time.
`;

export async function exportZip(): Promise<void> {
  await persistNow();
  const catalog = get(catalogStore);
  const worlds = get(worldsStore);

  const files: Record<string, Uint8Array> = {};

  // Shared taxonomy (one file). index.json is generated at build time — not exported.
  files['data-src/catalog.json'] = strToU8(stableStringify(canonCatalog(catalog)));

  // Per-world: metadata + ONE file per cell (the merge-clean layout).
  worlds.forEach((w, i) => {
    const { cells, ...meta } = canonWorld(w);
    files[`data-src/worlds/${w.id}/world.json`] = strToU8(stableStringify({ ...meta, order: i }));
    for (const cell of cells) {
      files[`data-src/worlds/${w.id}/cells/${cell.id}.json`] = strToU8(stableStringify(cell));
    }
  });

  // Referenced tile + icon images, committed under public/assets/.
  const wanted = new Map<string, string>(); // repo path → hash
  for (const w of worlds) for (const c of w.cells) wanted.set(`public/${c.image.src}`, c.image.hash);
  for (const icon of Object.values(catalog.icons)) {
    if (icon.type === 'img') {
      const hash = /([0-9a-f]+)\.[a-z0-9]+$/i.exec(icon.value)?.[1];
      if (hash) wanted.set(`public/${icon.value}`, hash);
    }
  }
  for (const [path, hash] of wanted) {
    const asset = await db.assets.get(hash);
    if (asset) files[path] = new Uint8Array(await asset.blob.arrayBuffer());
  }

  files['IMPORT-INSTRUCTIONS.txt'] = strToU8(README);

  const zipped = zipSync(files, { level: 6 });
  download(zipped, 'map-site-data.zip');
}

function download(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Deterministic JSON (sorted object keys; arrays keep order). */
function stableStringify(v: unknown): string {
  return JSON.stringify(sortKeys(v), null, 2) + '\n';
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sortKeys(v: any): any {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: any = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}
