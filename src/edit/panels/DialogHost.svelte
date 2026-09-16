<script lang="ts">
  import { activeDialog, type DialogRequest } from '../dialog';

  const dlg = $derived($activeDialog);
  let value = $state('');
  let card = $state<HTMLDivElement | null>(null);
  let returnFocusTo: HTMLElement | null = null;

  function titleFor(d: DialogRequest): string {
    if (d.title) return d.title;
    return d.kind === 'confirm' ? 'Please confirm' : d.kind === 'prompt' ? 'Enter a value' : 'Notice';
  }

  // Runs before the DOM updates: remember where focus came from when the first
  // dialog opens, seed the prompt input, and hand focus back once the last closes.
  $effect.pre(() => {
    if (dlg) {
      if (!returnFocusTo && document.activeElement instanceof HTMLElement) returnFocusTo = document.activeElement;
      value = dlg.kind === 'prompt' ? dlg.initial : '';
    } else if (returnFocusTo) {
      returnFocusTo.focus();
      returnFocusTo = null;
    }
  });

  function autofocus(node: HTMLElement, enabled: boolean = true) {
    if (!enabled) return;
    node.focus();
    if (node instanceof HTMLInputElement) node.select();
  }

  function ok() {
    if (!dlg) return;
    if (dlg.kind === 'prompt') {
      const v = value.trim();
      if (v || dlg.allowEmpty) dlg.settle(v);
    } else if (dlg.kind === 'confirm') dlg.settle(true);
    else dlg.settle();
  }

  function cancel() {
    if (!dlg) return;
    if (dlg.kind === 'prompt') dlg.settle(null);
    else if (dlg.kind === 'confirm') dlg.settle(false);
    else dlg.settle();
  }

  function onKey(e: KeyboardEvent) {
    if (!dlg) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else if (e.key === 'Tab' && card) {
      trapTab(e, card);
    }
  }

  /** Keep Tab cycling inside the dialog while it is open. */
  function trapTab(e: KeyboardEvent, root: HTMLElement) {
    const items = Array.from(root.querySelectorAll<HTMLElement>('input, button:not([disabled])'));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const inside = active instanceof HTMLElement && root.contains(active);
    const wrap = e.shiftKey ? active === first || !inside : active === last || !inside;
    if (wrap) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if dlg}
  {#key dlg}
    <div class="dlg-backdrop" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && cancel()}>
      <div
        class="dlg-card"
        bind:this={card}
        role={dlg.kind === 'alert' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby="dlg-title"
        aria-describedby="dlg-msg"
      >
        <form
          onsubmit={(e) => {
            e.preventDefault();
            ok();
          }}
        >
          <h3 id="dlg-title" class="dlg-title">{titleFor(dlg)}</h3>
          <p id="dlg-msg" class="dlg-msg">{dlg.message}</p>
          {#if dlg.kind === 'prompt'}
            <input class="dlg-input" bind:value use:autofocus />
          {/if}
          <div class="dlg-actions">
            {#if dlg.kind !== 'alert'}
              <button type="button" class="btn" onclick={cancel}>{dlg.cancelLabel ?? 'Cancel'}</button>
            {/if}
            <button
              type="submit"
              class="btn accent"
              class:danger={dlg.danger}
              disabled={dlg.kind === 'prompt' && !dlg.allowEmpty && !value.trim()}
              use:autofocus={dlg.kind !== 'prompt'}
            >
              {dlg.okLabel ?? 'OK'}
            </button>
          </div>
        </form>
      </div>
    </div>
  {/key}
{/if}
