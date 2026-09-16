<script lang="ts">
  import { untrack } from 'svelte';
  import { KIND_LABEL, type TaxKind, type TaxNode } from '../../model/types';
  import { getIcon } from '../../model/taxonomy';
  import {
    addTaxNode,
    catalog,
    checkedIds,
    deleteTaxNode,
    editMode,
    iconImgUrl,
    multiSelect,
    renameTaxNode,
    setTaxIconImage,
    toggleChecked,
  } from '../draftStore';
  import { confirmDialog, promptDialog } from '../dialog';
  import Self from './TaxEditNode.svelte';

  let { node, forest, depth = 0 }: { node: TaxNode; forest: TaxKind; depth?: number } = $props();
  let open = $state(untrack(() => depth < 2));
  let fileInput: HTMLInputElement;
  const children = $derived((node.children ?? []).slice().sort((a, b) => a.order - b.order));
  const iconDef = $derived($catalog ? getIcon($catalog, node.icon) : undefined);
  const leafName = $derived(KIND_LABEL[forest].one);
  const leafAbbr = $derived({ resource: 'res', location: 'loc', enemy: 'enm' }[forest]);

  const addSub = async () => {
    const n = await promptDialog('Subtype name?', '', { title: `New subtype in ${node.name}`, okLabel: 'Add' });
    if (n) addTaxNode(forest, node.id, 'group', n);
  };
  const addLeaf = async () => {
    const n = await promptDialog(`${capitalize(leafName)} name?`, '', {
      title: `New ${leafName} in ${node.name}`,
      okLabel: 'Add',
    });
    if (n) addTaxNode(forest, node.id, 'resource', n);
  };
  const rename = async () => {
    const n = await promptDialog('Name', node.name, { title: 'Rename', okLabel: 'Rename' });
    if (n) renameTaxNode(node.id, n);
  };
  const remove = async () => {
    const ok = await confirmDialog(`Delete "${node.name}"?`, { title: 'Delete', okLabel: 'Delete', danger: true });
    if (ok) deleteTaxNode(node.id);
  };
  const onIconFile = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (f) void setTaxIconImage(node.id, f);
    input.value = '';
  };
  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
</script>

<div class="tax-node">
  <div class="tax-row">
    {#if $multiSelect}
      <input
        type="checkbox"
        class="pick"
        checked={$checkedIds.has(node.id)}
        onchange={() => toggleChecked(node.id)}
        aria-label={`Select ${node.name}`}
      />
    {/if}
    {#if children.length}
      <span
        class="twisty"
        role="button"
        tabindex="0"
        onclick={() => (open = !open)}
        onkeydown={(e) => e.key === 'Enter' && (open = !open)}>{open ? '▾' : '▸'}</span
      >
    {:else}
      <span class="twisty leaf">·</span>
    {/if}
    {#if iconDef && iconDef.type === 'img'}
      <img class="ticon-img" src={iconImgUrl(iconDef.value)} alt="" />
    {:else if iconDef}
      <span class="ticon">{iconDef.value}</span>
    {/if}
    <span class="tname">{node.name}</span>

    {#if !$multiSelect}
      <span class="tax-actions">
        {#if node.kind === 'resource'}
          <button
            class="btn small accent"
            onclick={() => editMode.set({ kind: 'place', markerKind: forest, refId: node.id })}
          >
            place
          </button>
        {:else}
          <button class="iconbtn" title="Add subtype" onclick={addSub}>+sub</button>
          <button class="iconbtn" title={`Add ${leafName}`} onclick={addLeaf}>+{leafAbbr}</button>
        {/if}
        <button class="iconbtn" title="Set image icon" onclick={() => fileInput.click()}>icon</button>
        <button class="iconbtn" title="Rename" onclick={rename}>edit</button>
        <button class="iconbtn danger" title="Delete" onclick={remove}>del</button>
      </span>
    {/if}
    <input
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif"
      bind:this={fileInput}
      onchange={onIconFile}
      style="display:none"
    />
  </div>
  {#if open && children.length}
    <div class="tax-children">
      {#each children as c (c.id)}
        <Self node={c} {forest} depth={depth + 1} />
      {/each}
    </div>
  {/if}
</div>
