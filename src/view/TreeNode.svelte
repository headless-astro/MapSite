<script lang="ts">
  import type { TaxKind, TaxNode } from '../model/types';
  import { getIcon, subtreeResourceIds } from '../model/taxonomy';
  import { disabledFor, nodeCheckState } from '../logic/searchController';
  import { catalog, search, worldIndex, setLeavesEnabled, soloLeaves } from './store';
  import { untrack } from 'svelte';
  import Self from './TreeNode.svelte';

  let { node, kind, depth = 0 }: { node: TaxNode; kind: TaxKind; depth?: number } = $props();

  // Expand top-level groups by default; deeper ones start collapsed. `depth` is a
  // fixed prop per node, so read it once (untrack) — this is init, not reactive.
  let open = $state(untrack(() => depth < 1));
  let cb: HTMLInputElement | undefined = $state();

  const leafIds = $derived(subtreeResourceIds(node));
  const children = $derived(
    (node.children ?? []).slice().sort((a, b) => a.order - b.order),
  );

  const checkState = $derived.by(() => {
    const idx = $worldIndex;
    if (!idx) return 'empty' as const;
    return nodeCheckState(leafIds, disabledFor($search, kind), idx.present[kind]);
  });

  const count = $derived.by(() => {
    const idx = $worldIndex;
    if (!idx) return 0;
    let n = 0;
    for (const id of leafIds) n += idx.counts[kind].get(id) ?? 0;
    return n;
  });

  const icon = $derived($catalog ? getIcon($catalog, node.icon) : undefined);

  // HTML checkboxes can't bind `indeterminate`; sync it imperatively.
  $effect(() => {
    if (cb) {
      cb.checked = checkState === 'on';
      cb.indeterminate = checkState === 'mixed';
    }
  });

  function onToggle(e: Event) {
    setLeavesEnabled(kind, leafIds, (e.target as HTMLInputElement).checked);
  }
</script>

<div class="tree-node">
  <div class="tree-row" class:empty={checkState === 'empty'}>
    <span
      class="twisty"
      class:leaf={children.length === 0}
      role="button"
      tabindex="0"
      onclick={() => (open = !open)}
      onkeydown={(e) => e.key === 'Enter' && (open = !open)}
    >
      {children.length ? (open ? '▾' : '▸') : '·'}
    </span>
    <label>
      <input
        type="checkbox"
        class="tri"
        bind:this={cb}
        disabled={checkState === 'empty'}
        onchange={onToggle}
      />
      {#if icon && icon.type === 'emoji'}<span class="ticon">{icon.value}</span>{/if}
      <span class="tname">{node.name}</span>
    </label>
    {#if count > 0}<span class="count-badge">{count}</span>{/if}
    <button
      class="solo"
      title="Show only this"
      onclick={() => soloLeaves(kind, leafIds)}
      disabled={checkState === 'empty'}>solo</button
    >
  </div>

  {#if open && children.length}
    <div class="tree-children">
      {#each children as child (child.id)}
        <Self node={child} {kind} depth={depth + 1} />
      {/each}
    </div>
  {/if}
</div>
