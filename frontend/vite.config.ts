import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

const backend = 'http://127.0.0.1:8000';

// Khớp "/api/..." nhưng KHÔNG khớp trang "/api-keys" của giao diện.
const proxy: Record<string, ProxyOptions> = {
  '^/api(/|$)': { target: backend, changeOrigin: true },
  '^/v1(/|$)': { target: backend, changeOrigin: true },
  '^/webhooks(/|$)': { target: backend, changeOrigin: true },
};

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
  build: { outDir: 'dist', sourcemap: false },
});
