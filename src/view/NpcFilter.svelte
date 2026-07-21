<script lang="ts">
  import { getIcon } from '../model/taxonomy';
  import { catalog, search, worldIndex, setNpcTypeEnabled, setAllNpcTypes } from './store';

  const types = $derived.by(() => {
    const idx = $worldIndex;
    const cat = $catalog;
    if (!idx || !cat) return [];
    return cat.npcTypes
      .filter((t) => idx.presentNpcTypeIds.has(t.id))
      .slice()
      .sort((a, b) => a.order - b.order);
  });
  const untyped = $derived($worldIndex?.untypedNpcCount ?? 0);
</script>

{#if types.length || untyped}
  <div class="section">
    <h2>NPCs</h2>
    <div class="row" style="margin-bottom:6px">
      <button class="btn small" onclick={() => setAllNpcTypes(true)}>All</button>
      <button class="btn small" onclick={() => setAllNpcTypes(false)}>None</button>
    </div>
    {#each types as t (t.id)}
      {@const icon = $catalog ? getIcon($catalog, t.icon) : undefined}
      <label class="area-item">
        <input
          type="checkbox"
          checked={!$search.disabledNpcTypeIds.has(t.id)}
          onchange={(e) => setNpcTypeEnabled(t.id, (e.target as HTMLInputElement).checked)}
        />
        {#if icon && icon.type === 'emoji'}<span class="ticon">{icon.value}</span>{/if}
        <span class="tname">{t.name}</span>
        <span class="count-badge">{$worldIndex?.npcTypeCounts.get(t.id) ?? 0}</span>
      </label>
    {/each}
    {#if untyped}
      <div class="muted" style="margin-top:4px">+ {untyped} untyped NPC{untyped === 1 ? '' : 's'} (always shown)</div>
    {/if}
  </div>
{/if}
