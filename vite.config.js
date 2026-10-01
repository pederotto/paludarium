import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// three.js must exist exactly once. `three` (used by camera-controls and
// three-mesh-bvh) is pointed at the WebGPU build, the same build the game
// imports as `three/webgpu`, and three is served as-is instead of being
// pre-bundled into separate copies.
export default defineConfig({
  base: './',
  plugins: [preact()],
  resolve: {
    alias: [{ find: /^three$/, replacement: 'three/webgpu' }],
    dedupe: ['three'],
  },
  optimizeDeps: { exclude: ['three', 'three-mesh-bvh', 'camera-controls'] },
  server: { port: 5173, host: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
  },
});
