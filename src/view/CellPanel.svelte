<script lang="ts">
  // Right-hand panel with the clicked cell's name, area and author notes.
  import { selectedCellId, world } from './store';

  const cell = $derived($world?.cells.find((c) => c.id === $selectedCellId) ?? null);
  const areaName = $derived(cell?.areaId ? ($world?.areas.find((a) => a.id === cell.areaId)?.name ?? '') : '');
</script>

{#if cell}
  <aside class="side-panel" aria-label="Cell notes">
    <div class="sidebar-header">
      <div style="min-width:0">
        <h1 style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{cell.name}</h1>
        {#if areaName}<div class="muted" style="font-size:12px">{areaName}</div>{/if}
      </div>
      <button
        class="btn small"
        style="margin-left:auto"
        title="Close"
        aria-label="Close"
        onclick={() => selectedCellId.set(null)}>×</button
      >
    </div>
    <div class="sidebar-body">
      <div class="section">
        {#if cell.note}
          <div class="cell-note">{cell.note}</div>
        {:else}
          <div class="muted" style="font-size:13px">No notes for this cell.</div>
        {/if}
      </div>
    </div>
  </aside>
{/if}
