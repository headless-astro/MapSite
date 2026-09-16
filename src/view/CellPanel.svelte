<script lang="ts">
  // Right-hand panel with the clicked cell's name, area, author notes and jump links.
  import { indexTaxonomy } from '../model/taxonomy';
  import { markerLabel } from '../map/markerLayer';
  import { catalog, jumpToLink, selectedCellId, world, worldName } from './store';

  const cell = $derived($world?.cells.find((c) => c.id === $selectedCellId) ?? null);
  const areaName = $derived(cell?.areaId ? ($world?.areas.find((a) => a.id === cell.areaId)?.name ?? '') : '');
  const tax = $derived($catalog ? indexTaxonomy($catalog) : null);
  // Markers on this cell that lead somewhere (entrances, stairs, portals…).
  const exits = $derived(
    (cell?.markers ?? [])
      .filter((m) => m.link)
      .map((m) => ({
        id: m.id,
        label: $catalog && tax ? markerLabel(m, $catalog, tax) : m.nameOverride ?? 'Marker',
        link: m.link!,
      })),
  );
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
      {#if exits.length}
        <div class="section">
          <h2>Leads to</h2>
          {#each exits as x (x.id)}
            <div class="row" style="margin-bottom:6px">
              <button class="btn small" onclick={() => void jumpToLink(x.link)}>
                {x.label} → {worldName(x.link.worldId)}
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </aside>
{/if}
