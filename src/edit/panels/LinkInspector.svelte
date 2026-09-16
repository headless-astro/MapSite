<script lang="ts">
  import {
    worlds,
    activeWorldId,
    selectedLinkId,
    selectedCellId,
    selectLink,
    setConnectionLabel,
    setConnectionVia,
    deleteConnection,
  } from '../draftStore';
  import { confirmDialog, promptDialog } from '../dialog';
  import { plural } from '../plural';

  const world = $derived($worlds.find((w) => w.id === $activeWorldId) ?? null);
  const link = $derived((world?.connections ?? []).find((l) => l.id === $selectedLinkId) ?? null);
  const bends = $derived(link?.via?.length ?? 0);

  function cellName(id: string): string {
    return world?.cells.find((c) => c.id === id)?.name ?? '(missing cell)';
  }
  async function editLabel() {
    if (!link) return;
    const id = link.id;
    const n = await promptDialog('Label shown on the line (leave blank for none)', link.label ?? '', {
      title: 'Connection label',
      okLabel: 'Save',
      allowEmpty: true,
    });
    if (n !== null) setConnectionLabel(id, n);
  }
  async function remove() {
    if (!link) return;
    const id = link.id;
    const ok = await confirmDialog(`Delete the connection ${cellName(link.from.cellId)} → ${cellName(link.to.cellId)}?`, {
      title: 'Delete connection',
      okLabel: 'Delete',
      danger: true,
    });
    if (ok) deleteConnection(id);
  }
</script>

{#if link}
  <div class="section">
    <h2>Connection</h2>
    <div class="insp-row">
      <span>From</span>
      <button class="linkbtn" title="Open this cell" onclick={() => selectedCellId.set(link.from.cellId)}>
        {cellName(link.from.cellId)}
      </button>
    </div>
    <div class="insp-row">
      <span>To</span>
      <button class="linkbtn" title="Open this cell" onclick={() => selectedCellId.set(link.to.cellId)}>
        {cellName(link.to.cellId)}
      </button>
    </div>
    <div class="insp-row">
      <span>Label</span>
      <span style="width:auto; flex:1; color:inherit">{link.label ?? '—'}</span>
      <button class="iconbtn" onclick={editLabel}>edit</button>
    </div>
    <div class="insp-row">
      <span>Shape</span>
      <span style="width:auto; flex:1; color:inherit">{bends ? plural(bends, 'bend') : 'straight'}</span>
      <button class="iconbtn" disabled={!bends} onclick={() => setConnectionVia(link.id, [])}>straighten</button>
    </div>
    <div class="muted" style="font-size:12px; margin-top:8px; line-height:1.5">
      Drag the round handles to move an end or a bend. Click a <b>+</b> between two points to add a
      bend; double-click a bend to remove it. Drop an end on another tile to re-attach it there.
    </div>
    <div class="row" style="margin-top:10px">
      <button class="btn small" onclick={remove}>Delete connection</button>
      <button class="btn small" onclick={() => selectLink(null)}>Deselect</button>
    </div>
  </div>
{/if}
