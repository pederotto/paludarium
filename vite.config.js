import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { metricsCollector } from './tools/metrics-collector.mjs';

// three.js must exist exactly once. `three` (used by camera-controls and
// three-mesh-bvh) is pointed at the WebGPU build, the same build the game
// imports as `three/webgpu`, and three is served as-is instead of being
// pre-bundled into separate copies.
export default defineConfig({
  base: './',
  // metricsCollector adds nothing to the build; it gives `vite dev` and `vite preview` the recorder's endpoint (docs/METRICS.md).
  plugins: [preact(), metricsCollector()],
  resolve: {
    alias: [{ find: /^three$/, replacement: 'three/webgpu' }],
    dedupe: ['three'],
  },
  optimizeDeps: { exclude: ['three', 'three-mesh-bvh', 'camera-controls'] },
  server: { port: 5173, host: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    // Two pages: the game, and the test lab (lab.html, src/lab; index.html sends ?lab there). The lab is not linked from the game.
    rollupOptions: { input: { main: fileURLToPath(new URL('./index.html', import.meta.url)), lab: fileURLToPath(new URL('./lab.html', import.meta.url)) } },
  },
});
