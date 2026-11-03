import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the Vite server proxies REST and WebSocket traffic to the API,
// so the browser talks to a single origin (no CORS setup needed locally).
const target = process.env.VITE_PROXY_TARGET || 'http://localhost:5000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target, changeOrigin: true },
      '/socket.io': { target, ws: true, changeOrigin: true },
    },
  },
});
