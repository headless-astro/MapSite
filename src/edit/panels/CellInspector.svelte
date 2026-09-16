<script lang="ts">
  import { indexTaxonomy, npcTypeName, resolveResourceName } from '../../model/taxonomy';
  import {
    worlds,
    activeWorldId,
    selectedCellId,
    catalog,
    updateCell,
    setCellNote,
    deleteCell,
    deleteMarker,
    deleteMarkers,
    setMarkerName,
    setMarkerLink,
    setMarkerSizeOverride,
    deleteConnection,
    deleteConnections,
    setConnectionLabel,
    selectLink,
    multiSelect,
    checkedIds,
    toggleChecked,
    uncheck,
  } from '../draftStore';
  import {
    DEFAULT_MARKER_SIZE,
    KIND_LABEL,
    MARKER_KINDS,
    MARKER_SIZE_MAX,
    MARKER_SIZE_MIN,
    REVEAL_KEY,
    type Connection,
    type RevealDefaults,
    type RevealKey,
  } from '../../model/types';
  import { KIND_GLYPH } from '../../map/markerLayer';
  import { confirmDialog, promptDialog } from '../dialog';

  // One "revealed by default" checkbox per marker kind.
  const REVEAL_ROWS: { key: RevealKey; label: string }[] = MARKER_KINDS.map((k) => ({
    key: REVEAL_KEY[k],
    label: k === 'npc' ? 'NPCs' : KIND_LABEL[k].many,
  }));
  import { plural } from '../plural';
  import BulkRow from './BulkRow.svelte';

  const world = $derived($worlds.find((w) => w.id === $activeWorldId) ?? null);
  const cell = $derived(world?.cells.find((c) => c.id === $selectedCellId) ?? null);
  const tax = $derived(indexTaxonomy($catalog));
  const checkedMarkerIds = $derived((cell?.markers ?? []).filter((m) => $checkedIds.has(m.id)).map((m) => m.id));

  async function deleteCheckedMarkers() {
    const cellId = cell?.id;
    const cellName = cell?.name ?? '';
    const ids = checkedMarkerIds;
    if (!cellId || !ids.length) return;
    const ok = await confirmDialog(`Delete ${plural(ids.length, 'marker')} from "${cellName}"?`, {
      title: 'Delete selected',
      okLabel: 'Delete',
      danger: true,
    });
    if (ok) deleteMarkers(cellId, ids);
  }

  // Connections touching this cell, shown from this cell's point of view.
  const links = $derived(
    (world?.connections ?? []).filter((l) => l.from.cellId === cell?.id || l.to.cellId === cell?.id),
  );
  const checkedLinkIds = $derived(links.filter((l) => $checkedIds.has(l.id)).map((l) => l.id));
  function otherEnd(l: Connection): { arrow: string; cellId: string; name: string } {
    const cellId = l.from.cellId === cell?.id ? l.to.cellId : l.from.cellId;
    return {
      arrow: l.from.cellId === cell?.id ? '→' : '←',
      cellId,
      name: world?.cells.find((c) => c.id === cellId)?.name ?? '(missing cell)',
    };
  }
  async function editLabel(l: Connection) {
    const n = await promptDialog('Label shown on the line (leave blank for none)', l.label ?? '', {
      title: 'Connection label',
      okLabel: 'Save',
      allowEmpty: true,
    });
    if (n !== null) setConnectionLabel(l.id, n);
  }
  async function deleteCheckedLinks() {
    const ids = checkedLinkIds;
    if (!ids.length) return;
    const ok = await confirmDialog(`Delete ${plural(ids.length, 'connection')}?`, {
      title: 'Delete selected',
      okLabel: 'Delete',
      danger: true,
    });
    if (ok) deleteConnections(ids);
  }

  /** Size box: blank = follow the world default. */
  function onSizeInput(cellId: string, markerId: string, raw: string) {
    const n = Number(raw);
    setMarkerSizeOverride(cellId, markerId, raw.trim() === '' || !Number.isFinite(n) ? null : n);
  }

  async function removeCell(id: string, name: string) {
    const ok = await confirmDialog(`Delete the cell "${name}" and its markers?`, {
      title: 'Delete cell',
      okLabel: 'Delete',
      danger: true,
    });
    if (ok) deleteCell(id);
  }

  /** The type name ("Cave"), regardless of any custom name. */
  function typeName(m: { kind: string; refId: string | null }) {
    return m.kind === 'npc' ? npcTypeName($catalog, m.refId) : resolveResourceName(tax, m.refId);
  }
  function markerName(m: { kind: string; refId: string | null; nameOverride?: string }) {
    return m.nameOverride || typeName(m);
  }
  // Jump links: which marker's link editor is open, and the world picked before a cell is chosen.
  let linkEditing = $state<string | null>(null);
  let linkDraftWorld = $state('');
  const linkWorldId = $derived.by(() => {
    const m = cell?.markers.find((x) => x.id === linkEditing);
    return m?.link?.worldId ?? linkDraftWorld;
  });
  const linkCells = $derived(
    ($worlds.find((w) => w.id === linkWorldId)?.cells ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)),
  );
  function linkSummary(link: { worldId: string; cellId: string }): string {
    const w = $worlds.find((x) => x.id === link.worldId);
    const c = w?.cells.find((x) => x.id === link.cellId);
    return `${w?.name ?? '(missing world)'} › ${c?.name ?? '(missing cell)'}`;
  }
  function toggleLinkEditor(m: { id: string; link?: { worldId: string } }) {
    linkEditing = linkEditing === m.id ? null : m.id;
    linkDraftWorld = m.link?.worldId ?? '';
  }
  function pickLinkWorld(m: { id: string }, worldId: string) {
    linkDraftWorld = worldId;
    if (cell) setMarkerLink(cell.id, m.id, null); // a new world needs a new cell
  }
  function pickLinkCell(m: { id: string }, cellId: string) {
    if (!cell) return;
    setMarkerLink(cell.id, m.id, cellId && linkWorldId ? { worldId: linkWorldId, cellId } : null);
  }
  async function editMarkerName(cellId: string, m: { id: string; nameOverride?: string }) {
    const n = await promptDialog('Custom name for this marker (leave blank to show the type name)', m.nameOverride ?? '', {
      title: 'Marker name',
      okLabel: 'Save',
      allowEmpty: true,
    });
    if (n !== null) setMarkerName(cellId, m.id, n);
  }
  function setRevealDefault(key: RevealKey, value: boolean) {
    if (!cell) return;
    const defaultReveal: RevealDefaults = { ...cell.defaultReveal, [key]: value };
    updateCell(cell.id, { defaultReveal });
  }
</script>

{#if cell}
  <div class="section">
    <h2>Cell</h2>
    <label class="insp-row">
      <span>Name</span>
      <input value={cell.name} onchange={(e) => updateCell(cell.id, { name: (e.target as HTMLInputElement).value })} />
    </label>
    <label class="insp-row">
      <span>Area</span>
      <select
        value={cell.areaId ?? ''}
        onchange={(e) => updateCell(cell.id, { areaId: (e.target as HTMLSelectElement).value || null })}
      >
        <option value="">— none —</option>
        {#each world?.areas ?? [] as a (a.id)}
          <option value={a.id}>{a.name}</option>
        {/each}
      </select>
    </label>
    <label class="insp-row" style="align-items:flex-start">
      <span style="padding-top:4px">Notes</span>
      <textarea
        class="insp-note"
        rows="4"
        placeholder="Shown to players in a side panel when they click this tile"
        value={cell.note ?? ''}
        onchange={(e) => setCellNote(cell.id, (e.target as HTMLTextAreaElement).value)}
      ></textarea>
    </label>

    <label class="insp-check">
      <input
        type="checkbox"
        checked={cell.hidden}
        onchange={(e) => updateCell(cell.id, { hidden: (e.target as HTMLInputElement).checked })}
      />
      Hidden location (spoiler)
    </label>
    {#each REVEAL_ROWS as row (row.key)}
      <label class="insp-check">
        <input
          type="checkbox"
          checked={cell.defaultReveal[row.key] ?? true}
          onchange={(e) => setRevealDefault(row.key, (e.target as HTMLInputElement).checked)}
        />
        {row.label} revealed by default
      </label>
    {/each}

    <label class="insp-row">
      <span>Opacity</span>
      <input
        type="range"
        min="0.2"
        max="1"
        step="0.05"
        value={cell.geometry.opacity ?? 1}
        oninput={(e) =>
          updateCell(cell.id, {
            geometry: { ...cell.geometry, opacity: parseFloat((e.target as HTMLInputElement).value) },
          })}
      />
    </label>
    <div class="row">
      <button
        class="btn small"
        onclick={() => updateCell(cell.id, { geometry: { ...cell.geometry, z: cell.geometry.z - 1 } })}
        >Send back</button
      >
      <button
        class="btn small"
        onclick={() => updateCell(cell.id, { geometry: { ...cell.geometry, z: cell.geometry.z + 1 } })}
        >Bring front</button
      >
    </div>
    <label class="insp-check">
      <input
        type="checkbox"
        checked={cell.geometry.locked ?? false}
        onchange={(e) =>
          updateCell(cell.id, {
            geometry: { ...cell.geometry, locked: (e.target as HTMLInputElement).checked },
          })}
      />
      🔒 Lock position (can't be dragged)
    </label>

    <h2 style="margin-top:12px">Markers ({cell.markers.length})</h2>
    {#if !cell.markers.length}
      <div class="muted" style="font-size:12px">Use "Place" in the Taxonomy panel, then click this tile.</div>
    {:else if $multiSelect}
      <BulkRow
        summary={checkedMarkerIds.length ? plural(checkedMarkerIds.length, 'marker') : ''}
        ondelete={deleteCheckedMarkers}
        onclear={() => uncheck(checkedMarkerIds)}
      />
    {/if}
    {#each cell.markers as m (m.id)}
      <div class="insp-marker">
        {#if $multiSelect}
          <input
            type="checkbox"
            class="pick"
            checked={$checkedIds.has(m.id)}
            onchange={() => toggleChecked(m.id)}
            aria-label={`Select marker ${markerName(m)}`}
          />
        {/if}
        <span class="tname" title={m.nameOverride ? `${m.nameOverride} (${typeName(m)})` : typeName(m)}>
          {KIND_GLYPH[m.kind]} {markerName(m)}{#if m.nameOverride}<span class="muted" style="margin-left:4px">· {typeName(m)}</span>{/if}
        </span>
        {#if !$multiSelect}
          <button class="iconbtn" title="Custom name" onclick={() => editMarkerName(cell.id, m)}>name</button>
          <button
            class="iconbtn"
            class:on={!!m.link}
            title="Link: players can jump from this marker to a cell in another world"
            onclick={() => toggleLinkEditor(m)}>link</button
          >
          <input
            class="msize"
            type="number"
            min={MARKER_SIZE_MIN}
            max={MARKER_SIZE_MAX}
            placeholder={String(world?.view.markerSize ?? DEFAULT_MARKER_SIZE)}
            value={m.size ?? ''}
            title="Size in px for this marker (blank = world's marker size)"
            aria-label="Marker size"
            onchange={(e) => onSizeInput(cell.id, m.id, (e.target as HTMLInputElement).value)}
          />
          <button class="iconbtn danger" title="Delete marker" onclick={() => deleteMarker(cell.id, m.id)}>del</button>
        {/if}
      </div>
      {#if m.link && linkEditing !== m.id}
        <div class="insp-linksum muted">↗ {linkSummary(m.link)}</div>
      {/if}
      {#if linkEditing === m.id && !$multiSelect}
        <div class="insp-link">
          <select value={linkWorldId} onchange={(e) => pickLinkWorld(m, (e.target as HTMLSelectElement).value)} aria-label="Link world">
            <option value="">— world —</option>
            {#each $worlds as w (w.id)}
              <option value={w.id}>{w.name}</option>
            {/each}
          </select>
          <select
            value={m.link?.cellId ?? ''}
            disabled={!linkWorldId}
            onchange={(e) => pickLinkCell(m, (e.target as HTMLSelectElement).value)}
            aria-label="Link cell"
          >
            <option value="">— cell —</option>
            {#each linkCells as c (c.id)}
              <option value={c.id}>{c.name}</option>
            {/each}
          </select>
          <button class="iconbtn" title="Remove the link" disabled={!m.link} onclick={() => pickLinkCell(m, '')}>clear</button>
          <button class="iconbtn" title="Close" onclick={() => (linkEditing = null)}>done</button>
        </div>
      {/if}
    {/each}

    <h2 style="margin-top:12px">Connections ({links.length})</h2>
    {#if !links.length}
      <div class="muted" style="font-size:12px">
        Use "Connect cells" in the Structure panel, then click a point on this tile and one on another.
      </div>
    {:else if $multiSelect}
      <BulkRow
        summary={checkedLinkIds.length ? plural(checkedLinkIds.length, 'connection') : ''}
        ondelete={deleteCheckedLinks}
        onclear={() => uncheck(checkedLinkIds)}
      />
    {/if}
    {#each links as l (l.id)}
      {@const other = otherEnd(l)}
      <div class="insp-marker">
        {#if $multiSelect}
          <input
            type="checkbox"
            class="pick"
            checked={$checkedIds.has(l.id)}
            onchange={() => toggleChecked(l.id)}
            aria-label={`Select connection to ${other.name}`}
          />
        {/if}
        <span class="tname">
          {other.arrow}
          <button class="linkbtn" title="Go to this cell" onclick={() => selectedCellId.set(other.cellId)}>
            {other.name}
          </button>
          {#if l.label}<span class="muted">· {l.label}</span>{/if}
        </span>
        {#if !$multiSelect}
          <button class="iconbtn" title="Select on the map to bend or move it" onclick={() => selectLink(l.id)}>shape</button>
          <button class="iconbtn" title="Edit label" onclick={() => editLabel(l)}>label</button>
          <button class="iconbtn danger" title="Delete connection" onclick={() => deleteConnection(l.id)}>del</button>
        {/if}
      </div>
    {/each}

    <div class="row" style="margin-top:10px">
      <button class="btn small" onclick={() => removeCell(cell.id, cell.name)}>Delete cell</button>
    </div>
  </div>
{/if}
