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
  import { DEFAULT_MARKER_SIZE, MARKER_SIZE_MAX, MARKER_SIZE_MIN, type Connection } from '../../model/types';
  import { confirmDialog, promptDialog } from '../dialog';
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

  function markerName(m: { kind: string; refId: string | null; nameOverride?: string }) {
    if (m.nameOverride) return m.nameOverride;
    return m.kind === 'resource' ? resolveResourceName(tax, m.refId) : npcTypeName($catalog, m.refId);
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
    <label class="insp-check">
      <input
        type="checkbox"
        checked={cell.defaultReveal.resources}
        onchange={(e) =>
          updateCell(cell.id, {
            defaultReveal: { ...cell.defaultReveal, resources: (e.target as HTMLInputElement).checked },
          })}
      />
      Resources revealed by default
    </label>
    <label class="insp-check">
      <input
        type="checkbox"
        checked={cell.defaultReveal.npcs}
        onchange={(e) =>
          updateCell(cell.id, {
            defaultReveal: { ...cell.defaultReveal, npcs: (e.target as HTMLInputElement).checked },
          })}
      />
      NPCs revealed by default
    </label>

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
        <span class="tname">{m.kind === 'npc' ? '◆' : '●'} {markerName(m)}</span>
        {#if !$multiSelect}
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
