# Interactive Map

A static interactive map: image tiles ("cells") placed on a plane, grouped world → area →
cell, with resource, location, enemy and NPC markers. Players filter markers by type and
reveal areas at their own pace; their choices are saved in the browser. No backend. Leaflet + Svelte 5 + Vite +
TypeScript, hosted on GitHub Pages.

## What's in

- **Viewer**: worlds, areas, tiles (rotation allowed), markers, search by resource, location
  and enemy taxonomy and by NPC type, area filter, world switching (`#/w/<slug>`), cell labels, area outlines, cell
  connections, cell notes in a side panel, marker links that jump to a cell in another world,
  spoiler system (hidden tiles and markers revealed
  per area or per cell).
- **Editor** (local only, `npm run dev` then `?edit=1`, not shipped in builds): drag images
  in as tiles, move/scale/rotate them, manage worlds/areas/cells, write cell notes, the
  resource/location/enemy taxonomies and NPC types, place markers, set marker size, draw connections between tiles (with bends and labels),
  multi-select for bulk deletes, import from the site or a ZIP, export a ZIP for a PR.

Contributing is by Pull Request. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Develop

```bash
npm install
npm run dev        # http://localhost:5173  (add ?edit=1 for the editor)
npm run test
npm run check
npm run build      # → dist/
```

## Data

Source of truth is `data-src/`, one small file per cell so contributors rarely conflict:

```
data-src/
  catalog.json                 # taxonomy: resources, NPC types, icons
  worlds/<worldId>/
    world.json                 # name, view, config, areas, connections
    cells/<cellId>.json        # one cell with its markers
public/assets/<world>/img/<hash>.<ext>   # tile and icon images
```

`public/data/` is generated from `data-src/` by `scripts/build-data.mjs` (runs before
`dev`, `build` and `test`, or `npm run build:data`). It is gitignored; never edit it.

## Deploy

Push to `main`. `.github/workflows/deploy.yml` builds with `VITE_BASE=/<repo>/` and publishes
`dist/` to GitHub Pages. Enable once: Settings → Pages → Source: GitHub Actions.

## Code map

- `src/model/` — data types, ids, geometry, taxonomy, validation.
- `src/logic/` — pure search and reveal rules, unit tested.
- `src/map/` — Leaflet layers: tiles, markers, areas, connections, popups.
- `src/state/` — player state in `localStorage`.
- `src/view/` — viewer UI.
- `src/edit/` — the editor.
