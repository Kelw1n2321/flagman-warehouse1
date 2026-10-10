import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Сборка кладётся в wwwroot бэкенда: в продакшене API и интерфейс отдаются одним процессом.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:5080', changeOrigin: true } },
  },
  build: {
    outDir: '../backend/Flagman.Api/wwwroot',
    emptyOutDir: true,
  },
  test: { environment: 'node' },
});
