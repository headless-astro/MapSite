<script lang="ts">
  import { DEFAULT_MARKER_SIZE, MARKER_SIZE_MAX, MARKER_SIZE_MIN, type Cell } from '../../model/types';
  import {
    worlds,
    activeWorldId,
    selectedCellId,
    multiSelect,
    checkedIds,
    toggleChecked,
    toggleCellChecked,
    uncheck,
    addArea,
    renameArea,
    deleteArea,
    deleteAreas,
    deleteCells,
    renameWorld,
    deleteWorld,
    setMarkerSize,
    editMode,
  } from '../draftStore';
  import { confirmDialog, promptDialog } from '../dialog';
  import { plural } from '../plural';
  import BulkRow from './BulkRow.svelte';

  const world = $derived($worlds.find((w) => w.id === $activeWorldId) ?? null);
  const areas = $derived(world?.areas.slice().sort((a, b) => a.order - b.order) ?? []);
  const unassigned = $derived((world?.cells ?? []).filter((c) => !c.areaId));

  // Multi-select: what is ticked in this panel, summarised as "2 areas and 3 cells".
  const checkedAreaIds = $derived(areas.filter((a) => $checkedIds.has(a.id)).map((a) => a.id));
  const checkedCellIds = $derived((world?.cells ?? []).filter((c) => $checkedIds.has(c.id)).map((c) => c.id));
  const checkedSummary = $derived.by(() => {
    const parts: string[] = [];
    if (checkedAreaIds.length) parts.push(plural(checkedAreaIds.length, 'area'));
    if (checkedCellIds.length) parts.push(plural(checkedCellIds.length, 'cell'));
    return parts.join(' and ');
  });

  function cellsIn(areaId: string) {
    return (world?.cells ?? []).filter((c) => c.areaId === areaId);
  }
  async function newArea() {
    const n = await promptDialog('Area name?', 'New Area', { title: 'New area', okLabel: 'Add' });
    if (n) addArea(n);
  }
  async function renameWorldPrompt(id: string, current: string) {
    const n = await promptDialog('World name', current, { title: 'Rename world', okLabel: 'Rename' });
    if (n) renameWorld(id, n);
  }
  async function removeWorld(id: string, name: string) {
    const ok = await confirmDialog(`Delete the world "${name}" and all of its cells?`, {
      title: 'Delete world',
      okLabel: 'Delete',
      danger: true,
    });
    if (ok) deleteWorld(id);
  }
  async function renameAreaPrompt(id: string, current: string) {
    const n = await promptDialog('Area name', current, { title: 'Rename area', okLabel: 'Rename' });
    if (n) renameArea(id, n);
  }
  async function removeArea(id: string, name: string) {
    const ok = await confirmDialog(`Delete the area "${name}"? Its cells become unassigned.`, {
      title: 'Delete area',
      okLabel: 'Delete',
      danger: true,
    });
    if (ok) deleteArea(id);
  }
  async function deleteChecked() {
    // Snapshot before awaiting: the ticked set can change while the dialog is open.
    const areaIds = checkedAreaIds;
    const cellIds = checkedCellIds;
    const summary = checkedSummary;
    if (!summary) return;
    const ok = await confirmDialog(
      `Delete ${summary}? Deleted cells take their markers with them. Cells of a deleted area become unassigned.`,
      { title: 'Delete selected', okLabel: 'Delete', danger: true },
    );
    if (!ok) return;
    if (cellIds.length) deleteCells(cellIds);
    if (areaIds.length) deleteAreas(areaIds);
  }
</script>

{#snippet cellRow(c: Cell)}
  {#if $multiSelect}
    <label class="struct-cell" class:checked={$checkedIds.has(c.id)} class:sel={$selectedCellId === c.id}>
      <input type="checkbox" class="pick" checked={$checkedIds.has(c.id)} onchange={() => toggleCellChecked(c.id)} />
      <span>{c.hidden ? '🔒 ' : ''}{c.name}</span>
    </label>
  {:else}
    <button class="struct-cell" class:sel={$selectedCellId === c.id} onclick={() => selectedCellId.set(c.id)}>
      {c.hidden ? '🔒 ' : ''}{c.name}
    </button>
  {/if}
{/snippet}

<div class="section">
  <h2>Structure</h2>
  {#if !world}
    <div class="muted">Create a world to begin.</div>
  {:else}
    <div class="row" style="margin-bottom:6px">
      <button class="btn small" onclick={newArea}>+ Area</button>
      <button class="btn small" onclick={() => renameWorldPrompt(world.id, world.name)}>Rename world</button>
      <button class="btn small" onclick={() => removeWorld(world.id, world.name)}>Delete world</button>
      <button
        class="btn small"
        class:accent={$editMode.kind === 'connect'}
        title="Draw a link between two tiles: click the start point on one tile, then the end point on another"
        onclick={() => editMode.set({ kind: 'connect', from: null })}>Connect cells</button
      >
    </div>
    <label class="insp-row" style="margin-bottom:6px" title="Diameter of every marker on this world's map, for you and for players">
      <span style="width:auto">Marker size</span>
      <input
        type="range"
        min={MARKER_SIZE_MIN}
        max={MARKER_SIZE_MAX}
        step="1"
        value={world.view.markerSize ?? DEFAULT_MARKER_SIZE}
        oninput={(e) => setMarkerSize(Number((e.target as HTMLInputElement).value))}
      />
      <span style="width:36px; text-align:right">{world.view.markerSize ?? DEFAULT_MARKER_SIZE}px</span>
    </label>
    {#if $multiSelect}
      <BulkRow
        summary={checkedSummary}
        ondelete={deleteChecked}
        onclear={() => uncheck([...checkedAreaIds, ...checkedCellIds])}
      />
    {/if}

    {#each areas as a (a.id)}
      <div class="struct-area">
        <div class="struct-area-head">
          {#if $multiSelect}
            <input
              type="checkbox"
              class="pick"
              checked={$checkedIds.has(a.id)}
              onchange={() => toggleChecked(a.id)}
              aria-label={`Select area ${a.name}`}
            />
          {/if}
          <span class="tname">{a.name}</span>
          {#if !$multiSelect}
            <button class="iconbtn" title="Rename" onclick={() => renameAreaPrompt(a.id, a.name)}>edit</button>
            <button class="iconbtn danger" title="Delete" onclick={() => removeArea(a.id, a.name)}>del</button>
          {/if}
        </div>
        {#each cellsIn(a.id) as c (c.id)}
          {@render cellRow(c)}
        {/each}
      </div>
    {/each}

    {#if unassigned.length}
      <div class="struct-area">
        <div class="struct-area-head muted">Unassigned</div>
        {#each unassigned as c (c.id)}
          {@render cellRow(c)}
        {/each}
      </div>
    {/if}

    <div class="muted" style="font-size:12px; margin-top:8px">
      Drag image files onto the map to add tiles. <b>Drag a tile</b> to move it; select it to
      rotate/scale with the handles.
    </div>
  {/if}
</div>
