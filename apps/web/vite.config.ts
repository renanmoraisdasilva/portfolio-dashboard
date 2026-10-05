import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const apiTarget = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
      '/static': { target: apiTarget, changeOrigin: false },
      '/icon.png': { target: apiTarget, changeOrigin: false },
    },
  },
});
