<script lang="ts">
  import type { TaxNode } from '../../model/types';
  import { getIcon } from '../../model/taxonomy';
  import {
    addNpcType,
    addTaxNode,
    catalog,
    checkedIds,
    clearTaxonomy,
    deleteNpcType,
    deleteNpcTypes,
    deleteTaxNodes,
    editMode,
    iconImgUrl,
    multiSelect,
    renameNpcType,
    setTaxIconImage,
    toggleChecked,
    uncheck,
  } from '../draftStore';
  import { confirmDialog, promptDialog } from '../dialog';
  import { plural } from '../plural';
  import BulkRow from './BulkRow.svelte';
  import TaxEditNode from './TaxEditNode.svelte';

  const roots = $derived($catalog.resources.slice().sort((a, b) => a.order - b.order));
  const npcTypes = $derived($catalog.npcTypes.slice().sort((a, b) => a.order - b.order));

  function allIds(nodes: TaxNode[], out: string[] = []): string[] {
    for (const n of nodes) {
      out.push(n.id);
      if (n.children) allIds(n.children, out);
    }
    return out;
  }
  const checkedTaxIds = $derived(allIds($catalog.resources).filter((id) => $checkedIds.has(id)));
  const checkedNpcIds = $derived(npcTypes.filter((t) => $checkedIds.has(t.id)).map((t) => t.id));

  const addType = async () => {
    const n = await promptDialog('Type name? (e.g. Plant)', '', { title: 'New type', okLabel: 'Add' });
    if (n) addTaxNode(null, 'group', n);
  };
  const newNpc = async () => {
    const n = await promptDialog('NPC type name?', '', { title: 'New NPC type', okLabel: 'Add' });
    if (n) addNpcType(n);
  };
  const clearAll = async () => {
    const ok = await confirmDialog(
      'Remove ALL resources, NPC types, and every marker? Worlds and cells are kept. (Local only until you Export ZIP.)',
      { title: 'Clear taxonomy', okLabel: 'Remove all', danger: true },
    );
    if (ok) clearTaxonomy();
  };
  const renameNpc = async (id: string, current: string) => {
    const n = await promptDialog('NPC type name', current, { title: 'Rename NPC type', okLabel: 'Rename' });
    if (n) renameNpcType(id, n);
  };
  const removeNpc = async (id: string, name: string) => {
    const ok = await confirmDialog(`Delete the NPC type "${name}"?`, {
      title: 'Delete NPC type',
      okLabel: 'Delete',
      danger: true,
    });
    if (ok) deleteNpcType(id);
  };
  const deleteCheckedTax = async () => {
    const ids = checkedTaxIds;
    if (!ids.length) return;
    const ok = await confirmDialog(
      `Delete ${plural(ids.length, 'item')} from the resource tree? A type or subtype takes everything under it.`,
      { title: 'Delete selected', okLabel: 'Delete', danger: true },
    );
    if (ok) deleteTaxNodes(ids);
  };
  const deleteCheckedNpc = async () => {
    const ids = checkedNpcIds;
    if (!ids.length) return;
    const ok = await confirmDialog(`Delete ${plural(ids.length, 'NPC type')}?`, {
      title: 'Delete selected',
      okLabel: 'Delete',
      danger: true,
    });
    if (ok) deleteNpcTypes(ids);
  };
  const uploadIconFor = (id: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) void setTaxIconImage(id, f);
    };
    input.click();
  };
</script>

<div class="section">
  <h2>
    Resources
    <span style="float:right; display:inline-flex; gap:4px">
      <button
        class="iconbtn danger"
        title="Remove ALL resources, NPC types and their markers (keeps worlds & cells)"
        onclick={clearAll}>clear all</button
      >
      <button class="btn small" onclick={addType}>+ Type</button>
    </span>
  </h2>
  {#if !roots.length}
    <div class="muted" style="font-size:12px">Add a type, then add resources under it, then "place" onto tiles.</div>
  {:else if $multiSelect}
    <BulkRow
      summary={checkedTaxIds.length ? plural(checkedTaxIds.length, 'item') : ''}
      ondelete={deleteCheckedTax}
      onclear={() => uncheck(checkedTaxIds)}
    />
  {/if}
  {#each roots as node (node.id)}
    <TaxEditNode {node} />
  {/each}
</div>

<div class="section">
  <h2>NPC types <button class="btn small" style="float:right" onclick={newNpc}>+ NPC</button></h2>
  {#if $multiSelect && npcTypes.length}
    <BulkRow
      summary={checkedNpcIds.length ? plural(checkedNpcIds.length, 'NPC type') : ''}
      ondelete={deleteCheckedNpc}
      onclear={() => uncheck(checkedNpcIds)}
    />
  {/if}
  {#each npcTypes as t (t.id)}
    {@const ic = $catalog ? getIcon($catalog, t.icon) : undefined}
    <div class="tax-row">
      {#if $multiSelect}
        <input
          type="checkbox"
          class="pick"
          checked={$checkedIds.has(t.id)}
          onchange={() => toggleChecked(t.id)}
          aria-label={`Select ${t.name}`}
        />
      {/if}
      {#if ic && ic.type === 'img'}
        <img class="ticon-img" src={iconImgUrl(ic.value)} alt="" />
      {:else if ic}
        <span class="ticon">{ic.value}</span>
      {/if}
      <span class="tname">{t.name}</span>
      {#if !$multiSelect}
        <span class="tax-actions">
          <button class="btn small accent" onclick={() => editMode.set({ kind: 'addNpc', refId: t.id })}>place</button>
          <button class="iconbtn" title="Set image icon" onclick={() => uploadIconFor(t.id)}>icon</button>
          <button class="iconbtn" title="Rename" onclick={() => renameNpc(t.id, t.name)}>edit</button>
          <button class="iconbtn danger" title="Delete" onclick={() => removeNpc(t.id, t.name)}>del</button>
        </span>
      {/if}
    </div>
  {/each}
  <div class="tax-row" style="margin-top:4px">
    <button class="btn small" onclick={() => editMode.set({ kind: 'addNpc', refId: null })}>place untyped NPC</button>
  </div>
</div>
