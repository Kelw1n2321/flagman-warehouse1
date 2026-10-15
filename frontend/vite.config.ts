import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

// В режиме разработки /supplier открывает кабинет поставщика, как и на сервере.
const supplierRoute: Plugin = {
  name: 'supplier-route',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === '/supplier' || req.url === '/supplier/') req.url = '/supplier.html';
      next();
    });
  },
};

// Сборка кладётся в wwwroot бэкенда: в продакшене API и интерфейс отдаются одним процессом.
export default defineConfig({
  plugins: [react(), supplierRoute],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:5080', changeOrigin: true } },
  },
  build: {
    outDir: '../backend/Flagman.Api/wwwroot',
    emptyOutDir: true,
    // Две страницы: основной сайт и кабинет поставщика (/supplier).
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        supplier: fileURLToPath(new URL('./supplier.html', import.meta.url)),
      },
    },
  },
  test: { environment: 'node' },
});
