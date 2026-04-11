import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web/travle',
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
    proxy: {
      '/game': 'http://localhost:3000'
    }
  },
  build: {
    outDir: '../../dist/travle-web',
    emptyOutDir: true
  }
});
