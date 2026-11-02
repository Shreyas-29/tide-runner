import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        /* the libraries change rarely: their own chunk caches across deploys */
        manualChunks: { three: ['three'], vendor: ['postprocessing', '@takram/three-atmosphere', '@takram/three-clouds', '@takram/three-geospatial', '@takram/three-geospatial-effects'] },
      },
    },
  },
  server: { host: true },
});
