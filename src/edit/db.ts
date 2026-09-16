// Editor-local persistence (IndexedDB via Dexie). Holds the in-progress project
// draft (catalog + all worlds, as one document) and the staged image blobs
// (content-addressed by hash). None of this is deployed — it lives only in the
// author's browser until they Export a ZIP to commit.

import Dexie, { type Table } from 'dexie';
import type { Catalog, Vec2, World } from '../model/types';

/** The whole in-progress project as a single row. */
export interface DraftDoc {
  id: 'draft'; // singleton key
  catalog: Catalog;
  worlds: World[]; // order = manifest order
  updatedAt: number;
}

/** A staged tile image, keyed by its content hash. */
export interface AssetBlob {
  hash: string;
  mime: string;
  naturalSize: Vec2;
  ext: string; // "png" | "jpg" | "webp" | ...
  blob: Blob;
}

class EditorDB extends Dexie {
  drafts!: Table<DraftDoc, string>;
  assets!: Table<AssetBlob, string>;

  constructor() {
    super('mapsite-editor');
    this.version(1).stores({
      drafts: 'id',
      assets: 'hash',
    });
  }
}

export const db = new EditorDB();

/** SHA-256 of a blob → short hex hash used for content-addressed filenames. */
export async function hashBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < 8; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex; // 16 hex chars
}

export function extFromMime(mime: string): string {
  switch (mime) {
    case 'image/png': return 'png';
    case 'image/jpeg': return 'jpg';
    case 'image/webp': return 'webp';
    case 'image/gif': return 'gif';
    default: return 'png';
  }
}
