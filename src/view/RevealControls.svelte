<script lang="ts">
  import { globalTriState, type Tri } from '../logic/revealController';
  import { KIND_LABEL, MARKER_KINDS, REVEAL_KEY } from '../model/types';
  import { world, reveal, worldIndex, globalReveal } from './store';

  // One row per kind that has markers in this world; tri-state derived over
  // currently-rendered cells (R7).
  const rows = $derived.by(() => {
    const w = $world;
    const idx = $worldIndex;
    if (!w || !idx) return [];
    return MARKER_KINDS.filter((k) => idx.present[k].size > 0 || (k === 'npc' && idx.untypedNpcCount > 0)).map(
      (k) => ({
        kind: k,
        key: REVEAL_KEY[k],
        label: `All ${k === 'npc' ? 'NPCs' : KIND_LABEL[k].many.toLowerCase()}`,
        tri: globalTriState(w, $reveal, REVEAL_KEY[k]),
      }),
    );
  });

  // HTML checkboxes can't bind `indeterminate`; sync it imperatively.
  function tri(node: HTMLInputElement, state: Tri) {
    const apply = (s: Tri) => {
      node.checked = s === 'on';
      node.indeterminate = s === 'mixed';
    };
    apply(state);
    return { update: apply };
  }
</script>

<div class="section">
  <h2>Reveal</h2>
  {#each rows as row (row.kind)}
    <label class="area-item">
      <input
        type="checkbox"
        class="tri"
        use:tri={row.tri}
        disabled={row.tri === 'none'}
        onchange={() => globalReveal(row.key, row.tri !== 'on')}
      />
      <span class="tname">{row.label}</span>
    </label>
  {/each}
  {#if !rows.length}
    <div class="muted">No markers in this world.</div>
  {/if}
  <div class="muted" style="font-size:12px; margin-top:4px">
    Tip: click a tile to reveal just that location.
  </div>
</div>
