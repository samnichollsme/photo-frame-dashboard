import { defineConfig } from 'vite';

// The frame runs Android WebView 106. Same targets as dashboard/vite.config.js, for the same
// reasons: JS within Chromium 106, and CSS at chrome61 so the minifier never emits 4/8-digit hex.
export default defineConfig({
  build: {
    target: 'chrome106',
    cssTarget: 'chrome61',
  },
  server: {
    port: 5175,
    // `npm run api` serves /api on 8787; this lets `npm run dev` use it from a desktop browser.
    proxy: { '/api': 'http://localhost:8787' },
  },
});
