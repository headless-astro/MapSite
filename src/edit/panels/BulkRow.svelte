<script lang="ts">
  // Multi-select action row shown at the top of a list: "2 areas and 3 cells · Delete selected · clear".
  let { summary, ondelete, onclear }: { summary: string; ondelete: () => void; onclear: () => void } = $props();
</script>

<div class="bulk-row">
  <span class="muted">{summary || 'Nothing ticked yet'}</span>
  <button class="btn small danger" disabled={!summary} onclick={ondelete}>Delete selected</button>
  <button class="iconbtn" disabled={!summary} onclick={onclear}>clear</button>
</div>
