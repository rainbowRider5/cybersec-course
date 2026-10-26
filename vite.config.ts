import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` keeps the build portable: dist/ can be served from any sub-path.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    // The app chunk is mostly lesson text, which compresses well (~140 kB gzipped).
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // Libraries change rarely; keep them in their own cacheable chunk, apart from course content.
        manualChunks: (id) => (id.includes('node_modules') ? 'vendor' : undefined),
      },
    },
  },
});
