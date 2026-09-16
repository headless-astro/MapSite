<script lang="ts">
  import { globalTriState } from '../logic/revealController';
  import { world, reveal, globalReveal } from './store';

  // Tri-state derived over currently-rendered cells (R7).
  const resTri = $derived($world ? globalTriState($world, $reveal, 'resources') : 'none');
  const npcTri = $derived($world ? globalTriState($world, $reveal, 'npcs') : 'none');

  let resCb: HTMLInputElement | undefined = $state();
  let npcCb: HTMLInputElement | undefined = $state();

  $effect(() => {
    if (resCb) {
      resCb.checked = resTri === 'on';
      resCb.indeterminate = resTri === 'mixed';
    }
  });
  $effect(() => {
    if (npcCb) {
      npcCb.checked = npcTri === 'on';
      npcCb.indeterminate = npcTri === 'mixed';
    }
  });

  function toggle(kind: 'resources' | 'npcs', tri: string) {
    // ON reveals everything not yet revealed; a fully-on toggle sweeps OFF.
    globalReveal(kind, tri !== 'on');
  }
</script>

<div class="section">
  <h2>Reveal</h2>
  <label class="area-item">
    <input
      type="checkbox"
      class="tri"
      bind:this={resCb}
      disabled={resTri === 'none'}
      onchange={() => toggle('resources', resTri)}
    />
    <span class="tname">All resources</span>
  </label>
  <label class="area-item">
    <input
      type="checkbox"
      class="tri"
      bind:this={npcCb}
      disabled={npcTri === 'none'}
      onchange={() => toggle('npcs', npcTri)}
    />
    <span class="tname">All NPCs</span>
  </label>
  <div class="muted" style="font-size:12px; margin-top:4px">
    Tip: click a tile to reveal just that location.
  </div>
</div>
