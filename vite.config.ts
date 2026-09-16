import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Inject a Content-Security-Policy into the PRODUCTION index.html only. Applied
// at build time (`apply: 'build'`) so it never interferes with the dev server's
// HMR websocket or the dev-only editor's blob: image previews. The deployed
// viewer has no inline scripts and loads only same-origin assets, so this is a
// strong second line of defense behind output escaping.
function csp(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // Leaflet/Svelte set inline element styles
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ');
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml() {
      return [
        { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head' },
      ];
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [svelte(), csp()],
  build: {
    target: 'es2022',
    sourcemap: false, // don't ship readable source maps to the public site
  },
});
