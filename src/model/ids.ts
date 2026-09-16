// Stable, immutable, type-prefixed IDs. IDs are referenced everywhere; display
// `name`s are never referenced — so renaming an entity never breaks references.
//
// Generation is only needed in the editor (Phase 3); the viewer consumes IDs
// straight from committed data. Kept here so both share one definition.

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export type IdPrefix =
  | 'wld' // world
  | 'area'
  | 'cell'
  | 'mrk' // marker
  | 'lnk' // connection between two cells
  | 'type' // taxonomy group (a "type")
  | 'sub' // taxonomy group (a "subtype")
  | 'res' // taxonomy leaf in the resources forest
  | 'loc' // taxonomy leaf in the locations forest
  | 'enm' // taxonomy leaf in the enemies forest
  | 'npct' // npc type
  | 'ic'; // icon

/** Cryptographically-random id body of `size` chars from a 62-char alphabet. */
function randomBody(size = 8): string {
  const bytes = new Uint8Array(size);
  // crypto is available in browsers and Node 22 (globalThis.crypto).
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < size; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** e.g. newId('cell') -> "cell_a7Kf3xQ9". */
export function newId(prefix: IdPrefix, size = 8): string {
  return `${prefix}_${randomBody(size)}`;
}

/** The prefix portion of an id, or '' if malformed. */
export function idPrefix(id: string): string {
  const i = id.indexOf('_');
  return i < 0 ? '' : id.slice(0, i);
}

/**
 * A URL/file-safe slug derived from a display name, e.g. "The Mire" -> "the-mire".
 * Used for human-readable world deep-links (`#/w/<slug>`).
 */
export function slugify(name: string, fallback = 'world'): string {
  const s = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || fallback;
}
