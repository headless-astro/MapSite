<script lang="ts">
  import type { Id } from '../model/types';
  import { world, search, setAreaExcluded } from './store';

  const areas = $derived(($world?.areas ?? []).slice().sort((a, b) => a.order - b.order));

  // Per-area marker counts (cheap; recomputed on world change).
  const counts = $derived.by(() => {
    const m = new Map<Id, number>();
    for (const cell of $world?.cells ?? []) {
      if (!cell.areaId) continue;
      m.set(cell.areaId, (m.get(cell.areaId) ?? 0) + cell.markers.length);
    }
    return m;
  });

  function setAll(excluded: boolean) {
    for (const a of areas) setAreaExcluded(a.id, excluded);
  }
</script>

{#if areas.length > 1}
  <div class="section">
    <h2>Areas in search</h2>
    <div class="row" style="margin-bottom:6px">
      <button class="btn small" onclick={() => setAll(false)}>All</button>
      <button class="btn small" onclick={() => setAll(true)}>None</button>
    </div>
    {#each areas as a (a.id)}
      <label class="area-item">
        <input
          type="checkbox"
          checked={!$search.excludedAreaIds.has(a.id)}
          onchange={(e) => setAreaExcluded(a.id, !(e.target as HTMLInputElement).checked)}
        />
        <span class="tname">{a.name}</span>
        <span class="count-badge">{counts.get(a.id) ?? 0}</span>
      </label>
    {/each}
  </div>
{/if}
