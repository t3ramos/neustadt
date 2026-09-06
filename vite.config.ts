import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  optimizeDeps: { exclude: ['three-mesh-bvh'] },
  build: { rollupOptions: { output: { manualChunks: { three: ['three'], icons: ['lucide'] } } } },
});
