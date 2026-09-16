<script lang="ts">
  import { displayPrefs, setDisplayPref } from './store';
</script>

<div class="section">
  <h2>Map display</h2>
  <label class="area-item">
    <input
      type="checkbox"
      checked={$displayPrefs.cellLabels}
      onchange={(e) => setDisplayPref('cellLabels', (e.target as HTMLInputElement).checked)}
    />
    <span class="tname">Cell names</span>
  </label>
  <label class="area-item">
    <input
      type="checkbox"
      checked={$displayPrefs.areaRegions}
      onchange={(e) => setDisplayPref('areaRegions', (e.target as HTMLInputElement).checked)}
    />
    <span class="tname">Area outlines</span>
  </label>
</div>
