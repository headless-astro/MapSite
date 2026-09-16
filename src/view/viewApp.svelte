<script lang="ts">
  import { onMount } from 'svelte';
  import { MapController } from '../map/mapController';
  import { installFlushHandlers } from '../state/playerState';
  import {
    initApp,
    resetWorld,
    setCellReveal,
    status,
    errorMsg,
    warnings,
    toast,
    renderState,
    displayPrefs,
    selectedCellId,
    focusRequest,
    jumpToLink,
    worldName,
  } from './store';
  import CellPanel from './CellPanel.svelte';
  import WorldSwitcher from './WorldSwitcher.svelte';
  import RevealControls from './RevealControls.svelte';
  import SearchTree from './SearchTree.svelte';
  import NpcFilter from './NpcFilter.svelte';
  import AreaFilter from './AreaFilter.svelte';
  import DisplayOptions from './DisplayOptions.svelte';

  let mapEl: HTMLDivElement;
  let ctl: MapController | null = null;
  let collapsed = $state(false);
  let lastWorldId: string | null = null;
  let showWarnings = $state(false);

  onMount(() => {
    installFlushHandlers();
    ctl = new MapController(mapEl);
    ctl.setRevealHandlers({
      toggleCellReveal: setCellReveal,
      onCellSelected: (id) => selectedCellId.set(id),
    });
    ctl.setJumpHandlers({ jump: (link) => void jumpToLink(link), worldName });
    const unsubFocus = focusRequest.subscribe((req) => {
      if (req && ctl) ctl.focusCell(req.cellId);
    });

    const unsub = renderState.subscribe(({ world, catalog, search, reveal }) => {
      if (!ctl || !world || !catalog) return;
      if (world.id !== lastWorldId) {
        ctl.setWorld({ world, catalog }, reveal, search);
        lastWorldId = world.id;
      } else {
        ctl.applyState(reveal, search);
      }
    });
    const unsubPrefs = displayPrefs.subscribe((p) => ctl?.setDisplayPrefs(p));

    const onResize = () => ctl?.invalidateSize();
    window.addEventListener('resize', onResize);

    void initApp();

    return () => {
      unsub();
      unsubPrefs();
      unsubFocus();
      window.removeEventListener('resize', onResize);
      ctl?.destroy();
      ctl = null;
    };
  });

  // Re-measure the map when the sidebar collapses/expands.
  $effect(() => {
    void collapsed;
    setTimeout(() => ctl?.invalidateSize(), 220);
  });

  // Auto-dismiss transient toasts.
  $effect(() => {
    const t = $toast;
    if (!t) return;
    const id = setTimeout(() => toast.set(null), 3500);
    return () => clearTimeout(id);
  });
</script>

<div class="app-shell">
  <div class="map-root" bind:this={mapEl}></div>

  {#if collapsed}
    <button class="btn sidebar-toggle" title="Show panel" onclick={() => (collapsed = false)}>
      ☰
    </button>
  {/if}

  <aside class="sidebar" class:collapsed>
    <div class="sidebar-header">
      <h1>Interactive Map</h1>
      <button
        class="btn small"
        style="margin-left:auto"
        title="Hide panel"
        onclick={() => (collapsed = true)}>‹</button
      >
    </div>

    <div class="sidebar-body">
      {#if $status === 'loading'}
        <div class="section muted">Loading map data…</div>
      {:else if $status === 'error'}
        <div class="section">
          <div class="status-toast error" style="position:static">
            Failed to load: {$errorMsg}
          </div>
        </div>
      {:else}
        <WorldSwitcher />
        <RevealControls />
        <SearchTree kind="resource" />
        <SearchTree kind="location" hideWhenEmpty />
        <SearchTree kind="enemy" hideWhenEmpty />
        <NpcFilter />
        <AreaFilter />
        <DisplayOptions />

        <div class="section">
          <div class="row">
            <button class="btn small" onclick={resetWorld}>Reset this world's progress</button>
          </div>
          {#if $warnings.length}
            <div style="margin-top:8px">
              <button class="btn small" onclick={() => (showWarnings = !showWarnings)}>
                {$warnings.length} data warning{$warnings.length === 1 ? '' : 's'}
                {showWarnings ? '▾' : '▸'}
              </button>
              {#if showWarnings}
                <ul class="muted" style="font-size:12px; margin:6px 0 0; padding-left:16px">
                  {#each $warnings as w (w)}
                    <li>{w}</li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </aside>

  <CellPanel />

  {#if $toast}
    <div class="status-toast" class:error={$toast.error}>{$toast.msg}</div>
  {/if}
</div>
