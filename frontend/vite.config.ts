import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The FastAPI backend serves the built `dist/` folder in production.
// In development, everything under /api is proxied to it.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: false,
        // Long-lived requests (server-sent events, /wait long-polls) must not time out.
        timeout: 0,
        proxyTimeout: 0,
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq, req) => {
            // Never let anything compress the event stream: compression buffers chunks.
            if (req.url && req.url.includes('/events')) {
              proxyReq.setHeader('accept-encoding', 'identity');
            }
          });
          proxy.on('proxyRes', (proxyRes) => {
            const type = String(proxyRes.headers['content-type'] || '');
            if (type.includes('text/event-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache, no-transform';
              proxyRes.headers['x-accel-buffering'] = 'no';
              delete proxyRes.headers['content-length'];
            }
          });
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2020',
  },
});
