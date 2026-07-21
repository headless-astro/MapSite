import { defineConfig } from 'vitest/config';

// Unit tests cover the pure TS modules only (model/, logic/). No Svelte
// components or DOM are exercised, so a plain node environment is enough and we
// deliberately omit the svelte plugin to keep the test runner fast and simple.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
