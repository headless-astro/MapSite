<script lang="ts">
  import type { Id } from '../model/types';
  import { areaColorMap } from '../palette';
  import { world, search, reveal, setAreaExcluded, setAreaRevealHidden } from './store';

  const areas = $derived(($world?.areas ?? []).slice().sort((a, b) => a.order - b.order));
  const multi = $derived(areas.length > 1);
  const colors = $derived(areaColorMap($world?.areas ?? []));

  // Per-area total marker counts + hidden-cell counts (cheap; recomputed per world).
  const counts = $derived.by(() => {
    const m = new Map<Id, number>();
    const hidden = new Map<Id, number>();
    for (const cell of $world?.cells ?? []) {
      if (!cell.areaId) continue;
      m.set(cell.areaId, (m.get(cell.areaId) ?? 0) + cell.markers.length);
      if (cell.hidden) hidden.set(cell.areaId, (hidden.get(cell.areaId) ?? 0) + 1);
    }
    return { markers: m, hidden };
  });
  const anyHidden = $derived([...counts.hidden.values()].some((n) => n > 0));

  function setAllExcluded(excluded: boolean) {
    for (const a of areas) setAreaExcluded(a.id, excluded);
  }
</script>

{#if multi || anyHidden}
  <div class="section">
    <h2>Areas</h2>
    {#if multi}
      <div class="row" style="margin-bottom:6px">
        <span class="muted" style="font-size:12px">In search:</span>
        <button class="btn small" onclick={() => setAllExcluded(false)}>All</button>
        <button class="btn small" onclick={() => setAllExcluded(true)}>None</button>
      </div>
    {/if}
    {#each areas as a (a.id)}
      {@const hiddenN = counts.hidden.get(a.id) ?? 0}
      {@const revealed = $reveal.areaRevealHidden.has(a.id)}
      <div class="area-item">
        <label class="area-inc">
          {#if multi}
            <input
              type="checkbox"
              title="Include this area in search"
              checked={!$search.excludedAreaIds.has(a.id)}
              onchange={(e) => setAreaExcluded(a.id, !(e.target as HTMLInputElement).checked)}
            />
          {/if}
          <span class="swatch" style="background:{colors.get(a.id) ?? '#888'}"></span>
          <span class="tname">{a.name}</span>
        </label>
        <span class="count-badge">{counts.markers.get(a.id) ?? 0}</span>
        {#if hiddenN > 0}
          <button
            class="btn small"
            class:accent={revealed}
            title="Reveal this area's hidden locations (tiles only)"
            onclick={() => setAreaRevealHidden(a.id, !revealed)}
          >
            {revealed ? '👁 hidden' : `🔒 ${hiddenN}`}
          </button>
        {/if}
      </div>
    {/each}
  </div>
{/if}
