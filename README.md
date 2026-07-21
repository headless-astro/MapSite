# Arelith Interactive Map

An Infinity-Nikki-style interactive resource/NPC map for Arelith. Static, free to
host (GitHub Pages), no backend. Built with Leaflet + Svelte 5 + Vite + TypeScript.

The map is **additive**: each world is built from image tiles ("cells") placed on a
coordinate plane. Hierarchy is **world → area → cell**; resources and NPCs are
markers on cells. Players filter by a type→subtype→resource taxonomy and by NPC
type, all saved locally in their browser (per world).

## Status

**Phase 1 (current): viewer over hand-authored data.** Renders worlds/areas/cells +
resource/NPC markers, per-world resource & NPC search (variable-depth taxonomy with
solo / all / none), an included-areas filter, world switching, viewport culling, and
rotation-capable tiles. State persists per world in `localStorage`.

Later phases (see the plan): reveal & spoiler system, the in-app editor, editor
ergonomics, clustering/progress, and the future keyword-unlock.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run test       # unit tests (Vitest)
npm run check      # svelte-check + tsc
npm run build      # production build → dist/
npm run preview    # serve the built dist/
```

## Data layout (`public/data/`)

- `index.json` — manifest: the list of worlds + a pointer to the catalog (always loaded).
- `catalog.json` — shared taxonomy forest, NPC types, and icons (always loaded).
- `worlds/<id>.json` — one file per world: areas, cells, and their markers (loaded lazily,
  one world at a time — so searching one world never touches another).

Tile images live under `public/assets/<world>/img/`. Everything in `public/` is committed
as-is and served statically.

## Deploy (GitHub Pages)

Push to `main`. The workflow in `.github/workflows/deploy.yml` builds the viewer with
`VITE_BASE=/<repo>/` and publishes `dist/` to Pages. All data/asset fetches resolve
against that base path (see `src/paths.ts`), so the project-path hosting can't break them.

> Enable Pages once in the repo: **Settings → Pages → Build and deployment → Source:
> GitHub Actions.**

## Architecture (Phase 1)

- `src/model/` — shared, framework-free data model: `types`, `ids`, `geometry`,
  `taxonomy`, `schema` (defensive validation + migration).
- `src/logic/` — pure rules: `searchController` (S1–S5).
- `src/map/` — Leaflet layer (outside the component tree): `mapController`, `cellLayer`
  (affine transform handles axis-aligned *and* rotated tiles, + culling), `markerLayer`
  (registry + inverted indexes + culling).
- `src/state/` — `playerState` (per-world `localStorage`, the only writer of `arelith:v1:*`).
- `src/view/` — Svelte UI + the `store` that bridges data to the map.
