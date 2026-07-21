<script lang="ts">
  import { catalog, worldIndex, setAllResources } from './store';
  import TreeNode from './TreeNode.svelte';

  const roots = $derived(
    ($catalog?.resources ?? []).slice().sort((a, b) => a.order - b.order),
  );
  const hasAny = $derived(($worldIndex?.presentResourceIds.size ?? 0) > 0);
</script>

<div class="section">
  <h2>Resources</h2>
  {#if !hasAny}
    <div class="muted">No resources in this world.</div>
  {:else}
    <div class="row" style="margin-bottom:6px">
      <button class="btn small" onclick={() => setAllResources(true)}>All</button>
      <button class="btn small" onclick={() => setAllResources(false)}>None</button>
    </div>
    <div class="tree">
      {#each roots as node (node.id)}
        <TreeNode {node} depth={0} />
      {/each}
    </div>
  {/if}
</div>
