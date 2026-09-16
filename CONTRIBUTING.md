# Contributing to the map

The map has **no backend**. Everyone edits locally in the in-app editor, exports
the data, and opens a **Pull Request**. The maintainer reviews and merges; the
live site rebuilds automatically. Your edits never touch the live site directly.

## One-time setup

```bash
git clone <repo-url>
cd <repo>
npm install
```

## Make a change

1. **Branch:** `git checkout -b add-swamp-resources`
2. **Run the editor locally:**
   ```bash
   npm run dev
   ```
   Open **http://localhost:5173/?edit=1** (the `?edit=1` is what loads the editor;
   without it you get the player view). The editor is local-only and never deployed.
3. **Start from the live data:** click **Load published** in the toolbar. This pulls
   exactly what players currently see into the editor, so you build on top of it.
4. **Edit:**
   - **Drag image files onto the map** to add tiles. Select a tile to **move / scale /
     rotate** it with the handles.
   - Use the **Structure** panel to organise worlds → areas → cells.
   - Use the **Resources / Locations / Enemies / NPC types** panels to manage the taxonomy,
     then click **place** and click a tile to drop a marker.
   - Select a tile to edit its name, area, spoiler flags, and reveal defaults.
5. **Export:** click **Export ZIP**. The ZIP is a complete snapshot of the map: `data-src/`
   (one file per cell) and `public/assets/` (every image still in use).
6. **Replace the old data, then unzip.** Unzipping only adds and overwrites files, so anything
   you *deleted* in the editor (a cell, a world, an image) would survive as a leftover file
   and come straight back on the next build. Delete both folders first:
   ```bash
   rm -rf data-src public/assets      # PowerShell: Remove-Item -Recurse data-src, public/assets
   ```
   Then unzip into the repository ROOT. Git shows the deletions as normal changes.
7. **Check it locally (optional):** the player view reads generated files, so rebuild them:
   ```bash
   npm run build:data
   ```
   (This also runs by itself whenever `npm run dev` starts.) Then open
   http://localhost:5173/ without `?edit=1`.
8. **Commit & open a PR:**
   ```bash
   git add -A data-src public/assets
   git commit -m "Add swamp resource nodes"
   git push -u origin add-swamp-resources
   ```
   Open a Pull Request on GitHub. The maintainer reviews and merges; the site rebuilds
   `public/data/` from `data-src/` on its own during deploy.

## Why this stays clean

- **One file per cell** (`data-src/worlds/<world>/cells/<cellId>.json`) → you and another
  contributor adding different cells touch *different files*, so Git merges them with **no
  conflict**. Only editing the *same* cell conflicts (as it should).
- **Never edit `public/data/`** — it's generated from `data-src/` at build time (and
  gitignored). Only `data-src/` and `public/assets/` are committed.
- **Always start from Load published and replace the whole `data-src/` + `public/assets/`**
  with your export. The export is the full picture, so a delete in the editor becomes a
  deleted file in your PR instead of a stale file that resurrects the cell.
- **Content-addressed images** (`assets/<world>/img/<hash>.<ext>`) → no duplicate uploads;
  image changes show up as new files.
- Stable IDs + sorted keys keep every diff small and readable. Let the editor write the
  files; the player view validates on load and warns about anything malformed.

## Maintainer notes — security & who can edit

**The security model in one line:** anyone may *propose* a change (open a PR), but a
change only reaches players when **you merge it to `main`** — and only people you give
write access can merge. The editor being open is not a risk: it only writes to the
contributor's own browser and their own export ZIP; it has no path to the live site.

**Enforce that gate (GitHub settings — do these once):**

1. **Branch protection / Ruleset on `main`** (Settings → Rules → Rulesets):
   require a pull request, require **1 approving review**, **require review from Code
   Owners**, dismiss stale approvals on new commits, restrict who can push to you,
   block force-pushes and deletions.
2. **CODEOWNERS** — edit `.github/CODEOWNERS` and replace `@YOUR-GITHUB-USERNAME` with
   your handle. The catch-all makes every PR require your review.
3. **Actions permissions** (Settings → Actions → General): set the workflow token to
   **read-only**, uncheck "Allow Actions to create/approve PRs", and set
   "**Require approval for all outside collaborators**".
4. **`github-pages` environment** (Settings → Environments): restrict deployment
   branches to **`main` only**.
5. **Code security** (Settings → Code security): enable **Dependabot alerts + security
   updates** (config in `.github/dependabot.yml`) and **secret scanning + push
   protection**.

Keep the repo **public** — it gives you free branch protection and free Pages, and the
map is public anyway. Going private (to stop strangers *proposing*) needs a paid plan;
for a small trusted group, review-as-the-gate is the right, cheap design.

**Reviewing a PR — because contributor names, notes, and images render in every
player's browser, review more than the JSON:**

- **Open every new/changed image** under `public/assets/`. **Never merge an `.svg`,
  `.html`, or `.xml` asset** — those can execute script on the site's origin. (CI blocks
  these automatically via `.github/workflows/checks.yml`, and the editor only accepts
  raster images, but a hand-crafted commit could still add one — so eyeball it.)
- **Review code changes too, not just data.** The XSS escaping, the CSP in
  `index.html`/`vite.config.ts`, and the raster-only upload rule can all be silently
  reverted by a PR. Treat changes to `src/`, `index.html`, `vite.config.ts`, and
  `.github/` with extra scrutiny.
- JSON data is human-readable; skim names/notes for anything odd. Malformed JSON and
  unsafe asset types are rejected by the PR check before you can merge.

Merging to `main` triggers the Pages deploy workflow (build job is token-less; only the
deploy job holds the Pages token).
