// URL resolution for static hosting. GitHub Pages serves a project site under a
// base path (/<repo>/); Vite exposes it as import.meta.env.BASE_URL. EVERY fetch
// of data/assets goes through here so the base path can never break them.
// (Browser-only: not imported by the node unit tests.)

const BASE: string = import.meta.env.BASE_URL || '/';

/** Join the site base with a root-relative path. */
export function siteUrl(rel: string): string {
  return BASE.replace(/\/$/, '') + '/' + rel.replace(/^\//, '');
}

/** URL for a file under public/data/ (e.g. "index.json", "worlds/wld_x.json"). */
export function dataUrl(rel: string): string {
  return siteUrl('data/' + rel.replace(/^\//, ''));
}

/** URL for an authored asset whose path already includes "assets/..." */
export function assetUrl(rel: string): string {
  return siteUrl(rel);
}
