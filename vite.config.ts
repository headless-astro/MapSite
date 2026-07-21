import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// GitHub Pages serves a project site under /<repo>/. Set VITE_BASE to "/<repo>/"
// in the deploy workflow. Locally it defaults to "/". All runtime fetches of
// data/assets MUST resolve against import.meta.env.BASE_URL (see view/loaders.ts)
// so this base path can never break them.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [svelte()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
