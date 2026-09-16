// Bundle the per-cell SOURCE (data-src/) into the flat files the viewer loads
// (public/data/). This is what makes contribution merge-clean: contributors edit
// one small file per cell (data-src/worlds/<id>/cells/<cellId>.json), so two
// people adding different cells touch different files and never conflict. The
// player-facing viewer is unchanged — it still fetches one bundled file per world.
//
// public/data/ is a GENERATED artifact (gitignored). This runs before dev, build,
// and test (see package.json), and in CI via `npm run build`.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'data-src');
const OUT = join(ROOT, 'public', 'data');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
function writeJson(p, obj) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function build() {
  if (!existsSync(SRC)) {
    console.warn('[build-data] no data-src/ — writing an empty map.');
  }

  // Start clean so deleted worlds/cells don't linger.
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, 'worlds'), { recursive: true });

  // Shared catalog (one file; taxonomy).
  const catalogPath = join(SRC, 'catalog.json');
  const catalog = existsSync(catalogPath)
    ? readJson(catalogPath)
    : { schemaVersion: 1, resources: [], npcTypes: [], icons: {} };
  writeJson(join(OUT, 'catalog.json'), catalog);

  // Each world folder = world.json (metadata) + cells/<cellId>.json (one per cell).
  const worldsDir = join(SRC, 'worlds');
  const folders = existsSync(worldsDir)
    ? readdirSync(worldsDir, { withFileTypes: true }).filter((d) => d.isDirectory())
    : [];

  const refs = [];
  for (const d of folders) {
    const wdir = join(worldsDir, d.name);
    const metaPath = join(wdir, 'world.json');
    if (!existsSync(metaPath)) {
      console.warn(`[build-data] skipping ${d.name}: no world.json`);
      continue;
    }
    const { order = 0, thumbnail, ...meta } = readJson(metaPath);

    const cellsDir = join(wdir, 'cells');
    const cellFiles = existsSync(cellsDir)
      ? readdirSync(cellsDir).filter((f) => f.endsWith('.json'))
      : [];
    const cells = cellFiles.map((f) => readJson(join(cellsDir, f))).sort(byId);

    const world = { ...meta, cells };
    writeJson(join(OUT, 'worlds', `${world.id}.json`), world);

    refs.push({ order, ref: { id: world.id, slug: world.slug, name: world.name, data: `worlds/${world.id}.json`, ...(thumbnail ? { thumbnail } : {}) } });
  }

  refs.sort((a, b) => a.order - b.order || (a.ref.slug < b.ref.slug ? -1 : 1));
  writeJson(join(OUT, 'index.json'), {
    schemaVersion: catalog.schemaVersion ?? 1,
    app: 'map-site',
    catalog: 'catalog.json',
    worlds: refs.map((r) => r.ref),
  });

  console.log(`[build-data] bundled ${refs.length} world(s) → public/data/`);
}

build();
