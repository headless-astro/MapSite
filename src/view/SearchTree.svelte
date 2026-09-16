<script lang="ts">
  // Search tree for one taxonomy forest (resources, locations or enemies).
  import { KIND_LABEL, type TaxKind } from '../model/types';
  import { forestOf } from '../model/taxonomy';
  import { catalog, worldIndex, setAllLeaves } from './store';
  import TreeNode from './TreeNode.svelte';

  let { kind, hideWhenEmpty = false }: { kind: TaxKind; hideWhenEmpty?: boolean } = $props();

  const roots = $derived(($catalog ? forestOf($catalog, kind) : []).slice().sort((a, b) => a.order - b.order));
  const hasAny = $derived(($worldIndex?.present[kind].size ?? 0) > 0);
  const label = $derived(KIND_LABEL[kind]);
</script>

{#if hasAny || !hideWhenEmpty}
  <div class="section">
    <h2>{label.many}</h2>
    {#if !hasAny}
      <div class="muted">No {label.many.toLowerCase()} in this world.</div>
    {:else}
      <div class="row" style="margin-bottom:6px">
        <button class="btn small" onclick={() => setAllLeaves(kind, true)}>All</button>
        <button class="btn small" onclick={() => setAllLeaves(kind, false)}>None</button>
      </div>
      <div class="tree">
        {#each roots as node (node.id)}
          <TreeNode {node} {kind} depth={0} />
        {/each}
      </div>
    {/if}
  </div>
{/if}
