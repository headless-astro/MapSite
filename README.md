# Interactive Map

An Infinity-Nikki-style additive interactive resource/NPC map. Static, free to
host (GitHub Pages), no backend. Built with Leaflet + Svelte 5 + Vite + TypeScript.

The map is **additive**: each world is built from image tiles ("cells") placed on a
coordinate plane. Hierarchy is **world → area → cell**; resources and NPCs are
markers on cells. Players filter by a type→subtype→resource taxonomy and by NPC
type, all saved locally in their browser (per world).

## Status

**Phases 1–3 done: viewer + reveal system + in-app editor.**

- **Phase 1** — worlds/areas/cells + resource/NPC markers, per-world resource & NPC
  search (variable-depth taxonomy with solo / all / none), included-areas filter, world
  switching (`#/w/<slug>`), viewport culling, rotation-capable tiles. Persistent cell-name
  labels + per-area region outlines with a color legend.
- **Phase 2** — reveal & spoiler system (rules R1–R9): hidden tiles withheld (image not
  fetched until revealed), per-area "reveal hidden" (tiles-only), per-cell reveal via a
  tile-click popup, and a global tri-state "reveal all" sweep over currently-rendered
  cells (so unlocking a hidden area never auto-reveals its markers).
- **Phase 3** — the in-app **editor** (`npm run dev` + `?edit=1`; **excluded from
  production builds** via `import.meta.env.DEV`, so it can't be opened on the deployed
  site and its code/deps aren't even shipped): drag image files to add tiles,
  move/scale/rotate placement handles,
  worlds/areas/cells CRUD, a taxonomy + NPC-type editor, click-to-place markers, and
  **Import** (from the published site or a ZIP) + **Export ZIP** (deterministic JSON for
  clean PR diffs). Contribution is via Pull Request — see [CONTRIBUTING.md](CONTRIBUTING.md).

All player state persists per world in `localStorage`; editor drafts persist in IndexedDB.

**Later:** editor ergonomics (undo, File System Access direct-write), marker clustering,
progress tracking, and the future keyword-unlock. See the plan for the full roadmap.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run test       # unit tests (Vitest)
npm run check      # svelte-check + tsc
npm run build      # production build → dist/
npm run preview    # serve the built dist/
```

## Data layout — source vs. generated

**Source of truth is `data-src/` — one small file per cell** (so two contributors editing
different cells never conflict in Git):

```
data-src/
  catalog.json                       # shared taxonomy (resources, NPC types, icons)
  worlds/<worldId>/
    world.json                       # world metadata: name, view, config, areas
    cells/<cellId>.json              # ONE cell (+ its markers) per file
public/assets/<world>/img/<hash>.<ext>   # tile & icon images (committed, content-addressed)
```

**`public/data/` is GENERATED — never edit or commit it** (it's gitignored). The bundler
(`scripts/build-data.mjs`, run automatically before `dev`/`build`/`test`) stitches the
per-cell source into the flat files the viewer loads:

- `data/index.json` — manifest (worlds list + catalog pointer).
- `data/catalog.json` — the shared taxonomy.
- `data/worlds/<id>.json` — one bundled file per world (areas + all its cells).

So the **player side is unchanged** — it still fetches one file per world; the per-cell
split exists only to keep contributions merge-clean.

Run the bundler manually with `npm run build:data`.

## Deploy (GitHub Pages)

Push to `main`. The workflow in `.github/workflows/deploy.yml` builds the viewer with
`VITE_BASE=/<repo>/` and publishes `dist/` to Pages. All data/asset fetches resolve
against that base path (see `src/paths.ts`), so the project-path hosting can't break them.

> Enable Pages once in the repo: **Settings → Pages → Build and deployment → Source:
> GitHub Actions.**

## Architecture

- `src/model/` — shared, framework-free data model: `types`, `ids`, `geometry`,
  `taxonomy`, `schema` (defensive validation + migration).
- `src/logic/` — pure, unit-tested rules: `searchController` (S1–S5) and
  `revealController` (R1–R9).
- `src/map/` — Leaflet layer (outside the component tree): `mapController`, `cellLayer`
  (affine transform handles axis-aligned *and* rotated tiles, + culling + reveal-gated
  tiles), `markerLayer` (registry + inverted indexes + culling), `cellPopup`.
- `src/state/` — `playerState` (per-world `localStorage`, the only writer of `mapsite:v1:*`).
- `src/view/` — Svelte UI + the `store` that bridges data to the map.
