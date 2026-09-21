import { defineConfig } from 'tsup';

// Bundles the two Node entry points. The client is built by Vite into dist/client.
export default defineConfig({
  entry: { server: 'src/server/main.ts', worker: 'src/worker/main.ts' },
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  sourcemap: true,
  clean: false,
});
