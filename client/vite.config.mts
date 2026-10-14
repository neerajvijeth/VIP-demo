import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src'), '@shared': path.resolve(__dirname, '../shared') } },
  build: { outDir: path.resolve(__dirname, '../dist/client'), emptyOutDir: true, chunkSizeWarningLimit: 1200 },
  server: { port: 5173, proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true } } },
});
