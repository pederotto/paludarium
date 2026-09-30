import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// Relative base so the build works from any path (GitHub Pages project sites, itch.io, a local folder).
export default defineConfig({
  base: './',
  plugins: [preact()],
  server: { port: 5173, host: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: { manualChunks: { three: ['three', 'three/webgpu', 'three/tsl'] } },
    },
  },
});
