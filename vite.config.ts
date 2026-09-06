import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  optimizeDeps: { entries: ['index.html'], exclude: ['three-mesh-bvh'] },
  build: { rollupOptions: { output: { manualChunks: { three: ['three'], icons: ['lucide'] } } } },
});
