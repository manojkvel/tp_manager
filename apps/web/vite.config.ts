import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GAP-03 — §7 PWA / DoD #3.
// vite-plugin-pwa emits both `manifest.webmanifest` and the service worker
// (`sw.js`) at build time, satisfying the spec deliverable. Read-mostly endpoints
// (recipes, today's prep sheet, station view) are cached so cooks on flaky
// kitchen Wi-Fi can still pull up a recipe card or the prep list. Mutating
// requests (POST/PUT/PATCH) are never cached — they fail fast and surface a
// clear error in the UI.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon.svg'],
      manifest: {
        name: 'TP Manager',
        short_name: 'TP',
        description: 'Restaurant Operations Platform',
        theme_color: '#0f172a',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        lang: 'en',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/healthz/, /^\/metrics/],
        runtimeCaching: [
          {
            urlPattern: ({ url, request }) =>
              request.method === 'GET' &&
              (url.pathname.startsWith('/api/v1/recipes') ||
                url.pathname.startsWith('/api/v1/prep/sheet') ||
                url.pathname.startsWith('/api/v1/ingredients') ||
                url.pathname.startsWith('/api/v1/settings/stations')),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'tp-api-reads',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/v1/forecasts'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'tp-api-forecasts',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/healthz': { target: 'http://localhost:3001', changeOrigin: true },
      '/metrics': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
  },
});
