import { defineConfig } from 'vite';

export default defineConfig({
  // Relative paths so the build works on any static host or portal sub-folder.
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 800 },
});
