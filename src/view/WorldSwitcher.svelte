<script lang="ts">
  import { manifest, worldRef, selectWorld } from './store';

  function onChange(e: Event) {
    void selectWorld((e.target as HTMLSelectElement).value);
  }
</script>

{#if $manifest && $manifest.worlds.length > 1}
  <div class="section">
    <h2>World</h2>
    <select class="world-select" value={$worldRef?.id ?? ''} onchange={onChange}>
      {#each $manifest.worlds as w (w.id)}
        <option value={w.id}>{w.name}</option>
      {/each}
    </select>
  </div>
{/if}
