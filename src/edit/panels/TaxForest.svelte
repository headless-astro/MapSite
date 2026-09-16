<script lang="ts">
  // Editor section for one taxonomy forest (resources, locations or enemies).
  import { KIND_LABEL, type TaxKind, type TaxNode } from '../../model/types';
  import { forestOf } from '../../model/taxonomy';
  import { addTaxNode, catalog, checkedIds, deleteTaxNodes, multiSelect, uncheck } from '../draftStore';
  import { confirmDialog, promptDialog } from '../dialog';
  import { plural } from '../plural';
  import BulkRow from './BulkRow.svelte';
  import TaxEditNode from './TaxEditNode.svelte';

  let { kind }: { kind: TaxKind } = $props();

  const label = $derived(KIND_LABEL[kind]);
  const roots = $derived(forestOf($catalog, kind).slice().sort((a, b) => a.order - b.order));

  function allIds(nodes: TaxNode[], out: string[] = []): string[] {
    for (const n of nodes) {
      out.push(n.id);
      if (n.children) allIds(n.children, out);
    }
    return out;
  }
  const checkedTaxIds = $derived(allIds(roots).filter((id) => $checkedIds.has(id)));

  const addType = async () => {
    const n = await promptDialog('Type name? (e.g. Plant)', '', { title: `New ${label.one} type`, okLabel: 'Add' });
    if (n) addTaxNode(kind, null, 'group', n);
  };
  const deleteChecked = async () => {
    const ids = checkedTaxIds;
    if (!ids.length) return;
    const ok = await confirmDialog(
      `Delete ${plural(ids.length, 'item')} from the ${label.one} tree? A type or subtype takes everything under it.`,
      { title: 'Delete selected', okLabel: 'Delete', danger: true },
    );
    if (ok) deleteTaxNodes(ids);
  };
</script>

<div class="section">
  <h2>
    {label.many}
    <button class="btn small" style="float:right" onclick={addType}>+ Type</button>
  </h2>
  {#if !roots.length}
    <div class="muted" style="font-size:12px">
      Add a type, then add {label.many.toLowerCase()} under it, then "place" them onto tiles.
    </div>
  {:else if $multiSelect}
    <BulkRow
      summary={checkedTaxIds.length ? plural(checkedTaxIds.length, 'item') : ''}
      ondelete={deleteChecked}
      onclear={() => uncheck(checkedTaxIds)}
    />
  {/if}
  {#each roots as node (node.id)}
    <TaxEditNode {node} forest={kind} />
  {/each}
</div>
