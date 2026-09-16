<script lang="ts">
  import { getIcon } from '../../model/taxonomy';
  import {
    addNpcType,
    catalog,
    checkedIds,
    clearTaxonomy,
    deleteNpcType,
    deleteNpcTypes,
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
  import TaxForest from './TaxForest.svelte';

  const npcTypes = $derived($catalog.npcTypes.slice().sort((a, b) => a.order - b.order));
  const checkedNpcIds = $derived(npcTypes.filter((t) => $checkedIds.has(t.id)).map((t) => t.id));

  const newNpc = async () => {
    const n = await promptDialog('NPC type name?', '', { title: 'New NPC type', okLabel: 'Add' });
    if (n) addNpcType(n);
  };
  const clearAll = async () => {
    const ok = await confirmDialog(
      'Remove ALL resources, locations, enemies, NPC types, and every marker? Worlds and cells are kept. (Local only until you Export ZIP.)',
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

<TaxForest kind="resource" />
<TaxForest kind="location" />
<TaxForest kind="enemy" />

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
          <button
            class="btn small accent"
            onclick={() => editMode.set({ kind: 'place', markerKind: 'npc', refId: t.id })}>place</button
          >
          <button class="iconbtn" title="Set image icon" onclick={() => uploadIconFor(t.id)}>icon</button>
          <button class="iconbtn" title="Rename" onclick={() => renameNpc(t.id, t.name)}>edit</button>
          <button class="iconbtn danger" title="Delete" onclick={() => removeNpc(t.id, t.name)}>del</button>
        </span>
      {/if}
    </div>
  {/each}
  <div class="tax-row" style="margin-top:4px">
    <button class="btn small" onclick={() => editMode.set({ kind: 'place', markerKind: 'npc', refId: null })}>
      place untyped NPC
    </button>
  </div>
</div>

<div class="section">
  <button
    class="iconbtn danger"
    title="Remove ALL resources, locations, enemies, NPC types and their markers (keeps worlds & cells)"
    onclick={clearAll}>clear all taxonomy</button
  >
</div>
