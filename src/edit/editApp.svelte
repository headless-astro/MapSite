<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { EditorMap } from './editorMap';
  import {
    initDraft,
    persistNow,
    activeWorld,
    catalog,
    worlds,
    activeWorldId,
    selectedCellId,
    editMode,
    editorToast,
    addCellFromFile,
    addMarkerAtWorldPoint,
    updateCellGeometry,
    addWorld,
    multiSelect,
    checkedIds,
    toggleCellChecked,
  } from './draftStore';
  import { importFromPublishedSite } from './import';
  import { promptDialog } from './dialog';
  import Toolbar from './panels/Toolbar.svelte';
  import StructurePanel from './panels/StructurePanel.svelte';
  import TaxonomyPanel from './panels/TaxonomyPanel.svelte';
  import CellInspector from './panels/CellInspector.svelte';
  import DialogHost from './panels/DialogHost.svelte';

  let mapEl: HTMLDivElement;
  let em: EditorMap | null = null;

  onMount(() => {
    em = new EditorMap(mapEl, {
      onPick: (wp, cellId) => {
        if (get(editMode).kind !== 'select') addMarkerAtWorldPoint(wp);
        else if (get(multiSelect)) {
          if (cellId) toggleCellChecked(cellId);
        } else selectedCellId.set(cellId);
      },
      onSelect: (cellId) => selectedCellId.set(cellId),
      onDropFiles: (files, wp) => {
        for (const f of files) void addCellFromFile(f, wp);
      },
      onGeometryChange: (cellId, corners) => updateCellGeometry(cellId, corners),
    });

    const render = () => em?.render(activeWorld(), get(catalog), get(selectedCellId), get(checkedIds));
    const unsubs = [
      worlds.subscribe(render),
      catalog.subscribe(render),
      activeWorldId.subscribe(() => {
        em?.resetFraming();
        render();
      }),
      selectedCellId.subscribe(render),
      checkedIds.subscribe(render),
      editMode.subscribe((m) => {
        if (em) em.placing = m.kind !== 'select';
      }),
      multiSelect.subscribe((on) => {
        if (em) em.multiSelect = on;
      }),
    ];

    const onResize = () => em?.invalidateSize();
    window.addEventListener('resize', onResize);
    const onUnload = () => void persistNow();
    window.addEventListener('beforeunload', onUnload);

    void initDraft();

    return () => {
      unsubs.forEach((u) => u());
      window.removeEventListener('resize', onResize);
      window.removeEventListener('beforeunload', onUnload);
      void persistNow();
      em?.destroy();
      em = null;
    };
  });

  $effect(() => {
    const t = $editorToast;
    if (!t) return;
    const id = setTimeout(() => editorToast.set(null), 3000);
    return () => clearTimeout(id);
  });

  let loading = $state(false);
  async function loadPublished() {
    loading = true;
    try {
      await importFromPublishedSite();
    } catch (e) {
      editorToast.set('Import failed: ' + (e as Error).message);
    }
    loading = false;
  }
  async function newWorld() {
    const n = await promptDialog('World name?', 'New World', { title: 'New world', okLabel: 'Create' });
    if (n) addWorld(n);
  }
</script>

<div class="editor-shell">
  <aside class="editor-left">
    <div class="editor-title">Map Editor <span class="muted">(local)</span></div>
    <div class="editor-scroll">
      <Toolbar />
      <StructurePanel />
      <TaxonomyPanel />
    </div>
  </aside>

  <div class="editor-map" bind:this={mapEl}></div>

  {#if !$worlds.length}
    <div class="editor-empty">
      <div class="editor-empty-card">
        <h3>Nothing to edit yet</h3>
        <p class="muted">Load the current published map to edit it, or start a brand-new world.</p>
        <div class="row" style="justify-content:center; margin-top:12px">
          <button class="btn accent" onclick={loadPublished} disabled={loading}>
            {loading ? 'Loading…' : 'Load published map'}
          </button>
          <button class="btn" onclick={newWorld}>+ New world</button>
        </div>
        <p class="muted" style="margin-top:14px; font-size:12px">
          Then drag image files onto the map to add tiles.
        </p>
      </div>
    </div>
  {/if}

  {#if $selectedCellId}
    <aside class="editor-right">
      <div class="editor-scroll"><CellInspector /></div>
    </aside>
  {/if}

  {#if $editMode.kind !== 'select'}
    <div class="place-banner">
      Placing a marker — click on a tile.
      <button class="btn small" onclick={() => editMode.set({ kind: 'select' })}>Done</button>
    </div>
  {/if}

  {#if $editorToast}<div class="status-toast">{$editorToast}</div>{/if}

  <DialogHost />
</div>
