import 'leaflet/dist/leaflet.css';
import './app.css';
import { mount } from 'svelte';
import ViewApp from './view/viewApp.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('Missing #app root element.');

const params = new URLSearchParams(location.search);

if (params.get('edit') === '1') {
  // The in-app editor is a separate, lazily-loaded chunk built in Phase 3.
  // Until then, ?edit=1 shows a notice rather than the (nonexistent) editor.
  target.innerHTML =
    '<div class="edit-placeholder">The in-app editor arrives in Phase 3. ' +
    'Open this page without <code>?edit=1</code> to use the viewer.</div>';
} else {
  mount(ViewApp, { target });
}
