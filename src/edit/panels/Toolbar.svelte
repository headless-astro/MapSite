<script lang="ts">
  import { get } from 'svelte/store';
  import {
    worlds,
    activeWorldId,
    setActiveWorld,
    addWorld,
    resetDraft,
    editorToast,
    multiSelect,
    setMultiSelect,
  } from '../draftStore';
  import { alertDialog, confirmDialog, promptDialog } from '../dialog';
  import { exportZip } from '../export';
  import { importFromPublishedSite, importFromZip } from '../import';

  let busy = $state(false);
  let fileInput: HTMLInputElement;

  const DISCARD_WARN =
    'This REPLACES your current local edits with the published data. Your unsaved local changes will be lost. Continue?';

  /** True when there is nothing to lose, otherwise asks the user first. */
  function okToDiscard(): Promise<boolean> {
    if (!get(worlds).length) return Promise.resolve(true);
    return confirmDialog(DISCARD_WARN, { title: 'Discard local edits?', okLabel: 'Replace', danger: true });
  }

  async function loadPublished() {
    if (!(await okToDiscard())) return;
    busy = true;
    try {
      await importFromPublishedSite();
      editorToast.set('Loaded current published data.');
    } catch (e) {
      void alertDialog('Import failed: ' + (e as Error).message, { title: 'Import failed' });
    }
    busy = false;
  }
  async function onZip(e: Event) {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    if (!(await okToDiscard())) {
      input.value = '';
      return;
    }
    busy = true;
    try {
      await importFromZip(f);
      editorToast.set('Imported ZIP.');
    } catch (err) {
      void alertDialog('Import failed: ' + (err as Error).message, { title: 'Import failed' });
    }
    busy = false;
    input.value = '';
  }
  async function newWorld() {
    const n = await promptDialog('World name?', 'New World', { title: 'New world', okLabel: 'Create' });
    if (n) addWorld(n);
  }
  async function doReset() {
    const ok = await confirmDialog('Discard ALL local editor data? (Published data is unaffected.)', {
      title: 'Reset editor',
      okLabel: 'Discard everything',
      danger: true,
    });
    if (ok) await resetDraft();
  }
</script>

<div class="section">
  <div class="row">
    <button class="btn small" onclick={newWorld}>+ World</button>
    <button class="btn small" onclick={loadPublished} disabled={busy}>Load published</button>
    <button class="btn small" onclick={() => fileInput.click()} disabled={busy}>Import ZIP</button>
    <button class="btn small accent" onclick={exportZip}>Export ZIP</button>
    <button class="btn small" onclick={doReset}>Reset</button>
    <input type="file" accept=".zip" bind:this={fileInput} onchange={onZip} style="display:none" />
  </div>
  {#if $worlds.length}
    <select
      class="world-select"
      style="margin-top:8px"
      value={$activeWorldId ?? ''}
      onchange={(e) => setActiveWorld((e.target as HTMLSelectElement).value)}
    >
      {#each $worlds as w (w.id)}
        <option value={w.id}>{w.name}</option>
      {/each}
    </select>
  {/if}
  <label class="insp-check" style="margin-top:8px">
    <input
      type="checkbox"
      checked={$multiSelect}
      onchange={(e) => setMultiSelect((e.target as HTMLInputElement).checked)}
    />
    Multi-select mode
  </label>
  {#if $multiSelect}
    <div class="muted" style="font-size:11px; line-height:1.5">
      Tick areas, cells, markers, resources or NPC types below (or click tiles on the map), then press
      <b>Delete selected</b> in that section.
    </div>
  {/if}
  <div class="muted" style="font-size:11px; margin-top:8px; line-height:1.5">
    Edits <b>auto-save</b> to this browser. <b>Export ZIP</b> to publish. “Load published”
    &amp; “Import ZIP” <b>discard</b> your local edits.
  </div>
</div>
