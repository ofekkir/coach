import { resolve } from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: '',
  build: {
    outDir: resolve(import.meta.dirname, '../src/graph/viz-dist'),
    emptyOutDir: true,
  },
});
