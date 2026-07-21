// Fetch + validate committed data. Every path goes through dataUrl() so the
// GitHub Pages base path can't break fetches. Boot loads only index.json +
// catalog.json (both tiny); a world file is fetched lazily on selection.

import { dataUrl } from '../paths';
import {
  validateCatalog,
  validateManifest,
  validateWorld,
  type ValidationResult,
} from '../model/schema';
import type { Catalog, Manifest, World } from '../model/types';

async function fetchJson(url: string, what: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-cache' });
  } catch (e) {
    throw new Error(`Could not fetch ${what} (${url}): ${(e as Error).message}`);
  }
  if (!res.ok) throw new Error(`Could not load ${what}: HTTP ${res.status} (${url})`);
  try {
    return await res.json();
  } catch {
    throw new Error(`${what} is not valid JSON (${url}).`);
  }
}

export async function loadManifest(): Promise<ValidationResult<Manifest>> {
  return validateManifest(await fetchJson(dataUrl('index.json'), 'index.json'));
}

export async function loadCatalog(manifest: Manifest): Promise<ValidationResult<Catalog>> {
  return validateCatalog(await fetchJson(dataUrl(manifest.catalog), 'catalog.json'));
}

export async function loadWorld(
  dataPath: string,
  catalog: Catalog,
): Promise<ValidationResult<World>> {
  return validateWorld(await fetchJson(dataUrl(dataPath), `world file ${dataPath}`), catalog);
}
