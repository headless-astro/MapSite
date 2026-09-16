import 'leaflet/dist/leaflet.css';
import './app.css';
import { mount } from 'svelte';

const target = document.getElementById('app');
if (!target) throw new Error('Missing #app root element.');

const params = new URLSearchParams(location.search);
const wantsEditor = params.get('edit') === '1';

// The editor is LOCAL-ONLY: it is gated on Vite's `import.meta.env.DEV`, which is
// a literal `false` in production. Rollup dead-code-eliminates this whole branch
// from the production build, so the editor chunk is never even emitted to dist/
// and cannot be opened on the deployed site — only via `npm run dev` + ?edit=1.
if (import.meta.env.DEV && wantsEditor) {
  void import('./edit/editApp.svelte').then(({ default: EditApp }) => {
    mount(EditApp, { target });
  });
} else {
  if (wantsEditor) {
    // Deployed site: no editor here. Contributors edit locally and open a PR.
    console.info('The editor runs locally only: `npm run dev`, then open ?edit=1. See CONTRIBUTING.md.');
  }
  void import('./view/viewApp.svelte').then(({ default: ViewApp }) => {
    mount(ViewApp, { target });
  });
}
