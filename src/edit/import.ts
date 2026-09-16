// Import an existing project into the editor — either from a ZIP the author
// picks, or straight from the published site (so a contributor always starts
// from exactly what players currently see, then opens a PR with their changes).

import { unzipSync } from 'fflate';
import type { Catalog, Vec2, World } from '../model/types';
import { validateCatalog, validateWorld } from '../model/schema';
import { siteUrl } from '../paths';
import { loadCatalog, loadManifest, loadWorld } from '../view/loaders';
import { extFromMime, type AssetBlob } from './db';
import { loadProject } from './draftStore';

// --------------------------------------------------------------------------
// From the published site (reuses the viewer's validated loaders)
// --------------------------------------------------------------------------
export async function importFromPublishedSite(): Promise<void> {
  const manifest = (await loadManifest()).value;
  const catalog = (await loadCatalog(manifest)).value;
  const worlds: World[] = [];
  for (const ref of manifest.worlds) {
    worlds.push((await loadWorld(ref.data, catalog)).value);
  }
  const tileAssets = await fetchAssets(worlds, (src) => siteUrl(src));
  const iconAssets = await fetchIconAssets(catalog, (src) => siteUrl(src));
  await loadProject(catalog, worlds, [...tileAssets, ...iconAssets]);
}

// --------------------------------------------------------------------------
// From a ZIP produced by Export (or hand-assembled in the same layout)
// --------------------------------------------------------------------------
export async function importFromZip(file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(bytes);
  const keys = Object.keys(entries);

  const readJson = (path: string): unknown => {
    const found = keys.find((k) => k.endsWith(path));
    if (!found) throw new Error(`ZIP missing ${path}`);
    try {
      return JSON.parse(new TextDecoder().decode(entries[found]));
    } catch {
      throw new Error(`ZIP has invalid JSON in ${path}`);
    }
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parse = (k: string): any => JSON.parse(new TextDecoder().decode(entries[k]));

  const catalog = validateCatalog(readJson('data-src/catalog.json')).value;

  // Reassemble each world from world.json (metadata) + cells/<cellId>.json.
  const worlds: World[] = [];
  const worldMetaKeys = keys.filter((k) => /data-src\/worlds\/[^/]+\/world\.json$/.test(k));
  for (const metaKey of worldMetaKeys) {
    const wid = /data-src\/worlds\/([^/]+)\/world\.json$/.exec(metaKey)?.[1] ?? '';
    const meta = parse(metaKey);
    delete meta.order;
    delete meta.thumbnail;
    const cellPrefix = `data-src/worlds/${wid}/cells/`;
    const cells = keys.filter((k) => k.includes(cellPrefix) && k.endsWith('.json')).map(parse);
    worlds.push(validateWorld({ ...meta, cells }, catalog).value);
  }
  if (!worlds.length) {
    throw new Error('ZIP has no worlds (expected data-src/worlds/<id>/world.json).');
  }

  // Asset bytes are inside the ZIP under public/assets/… (matched by path suffix).
  const naturalByHash = new Map<string, Vec2>();
  const mimeByHash = new Map<string, string>();
  for (const w of worlds) {
    for (const c of w.cells) {
      naturalByHash.set(c.image.hash, c.image.naturalSize);
      mimeByHash.set(c.image.hash, c.image.mime);
    }
  }
  const assets: AssetBlob[] = [];
  for (const w of worlds) {
    for (const c of w.cells) {
      const entryKey = Object.keys(entries).find((k) => k.endsWith(c.image.src));
      if (!entryKey) continue;
      const mime = mimeByHash.get(c.image.hash) ?? 'image/png';
      assets.push({
        hash: c.image.hash,
        mime,
        ext: extFromMime(mime),
        naturalSize: naturalByHash.get(c.image.hash) ?? [1, 1],
        blob: new Blob([entries[entryKey]], { type: mime }),
      });
    }
  }
  // Custom image icons stored in the ZIP under assets/icons/…
  for (const icon of Object.values(catalog.icons)) {
    if (icon.type !== 'img') continue;
    const hash = hashFromPath(icon.value);
    if (!hash) continue;
    const key = Object.keys(entries).find((k) => k.endsWith(icon.value));
    if (!key) continue;
    const ext = extFromPath(icon.value);
    const mime = mimeFromExt(ext);
    assets.push({ hash, mime, ext, naturalSize: [16, 16], blob: new Blob([entries[key]], { type: mime }) });
  }
  await loadProject(catalog, worlds, dedupeAssets(assets));
}

// --------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------
async function fetchAssets(worlds: World[], urlOf: (src: string) => string): Promise<AssetBlob[]> {
  const byHash = new Map<string, { src: string; mime: string; naturalSize: Vec2 }>();
  for (const w of worlds) {
    for (const c of w.cells) {
      if (!byHash.has(c.image.hash)) {
        byHash.set(c.image.hash, { src: c.image.src, mime: c.image.mime, naturalSize: c.image.naturalSize });
      }
    }
  }
  const out: AssetBlob[] = [];
  for (const [hash, info] of byHash) {
    try {
      const res = await fetch(urlOf(info.src), { cache: 'no-cache' });
      if (!res.ok) continue;
      const blob = await res.blob();
      out.push({ hash, mime: info.mime, ext: extFromMime(info.mime), naturalSize: info.naturalSize, blob });
    } catch {
      // skip a missing asset; the cell will render a placeholder in the editor
    }
  }
  return out;
}

async function fetchIconAssets(
  catalog: Catalog,
  urlOf: (src: string) => string,
): Promise<AssetBlob[]> {
  const out: AssetBlob[] = [];
  for (const icon of Object.values(catalog.icons)) {
    if (icon.type !== 'img') continue;
    const hash = hashFromPath(icon.value);
    if (!hash) continue;
    try {
      const res = await fetch(urlOf(icon.value), { cache: 'no-cache' });
      if (!res.ok) continue;
      const blob = await res.blob();
      out.push({
        hash,
        mime: blob.type || mimeFromExt(extFromPath(icon.value)),
        ext: extFromPath(icon.value),
        naturalSize: [16, 16],
        blob,
      });
    } catch {
      // skip a missing icon asset
    }
  }
  return dedupeAssets(out);
}

function dedupeAssets(assets: AssetBlob[]): AssetBlob[] {
  const seen = new Set<string>();
  return assets.filter((a) => (seen.has(a.hash) ? false : (seen.add(a.hash), true)));
}

function hashFromPath(p: string): string | null {
  return /([0-9a-f]+)\.[a-z0-9]+$/i.exec(p)?.[1] ?? null;
}
function extFromPath(p: string): string {
  return p.split('.').pop()?.toLowerCase() || 'png';
}
function mimeFromExt(ext: string): string {
  return ext === 'jpg' || ext === 'jpeg'
    ? 'image/jpeg'
    : ext === 'webp'
      ? 'image/webp'
      : ext === 'gif'
        ? 'image/gif'
        : 'image/png';
}
