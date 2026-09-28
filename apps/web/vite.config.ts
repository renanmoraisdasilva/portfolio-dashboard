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
    // The dev server never talks to the database directly: everything goes
    // through the API, which runs separately on :3000.
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
    },
  },
});
