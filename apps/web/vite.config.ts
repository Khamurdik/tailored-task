import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
// Plain Vite, not `vitest/config`. This package carries no test runner — the
// whole suite is @dataroom/tests — so `vitest` does not resolve from here and
// importing it made `vite dev` and `vite build` fail to load their own config.
import { defineConfig } from 'vite';

export default defineConfig({
  // Tailwind v4 runs as a Vite plugin. There is no tailwind.config.js and no
  // postcss.config.js — the theme lives in src/index.css behind @theme.
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  server: {
    port: 5173,
    // Same-origin API in dev, matching the Vercel rewrite in prod. Auth uses
    // bearer tokens rather than cookies, so this is about keeping one base URL
    // across environments — not a credentials workaround.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },

  build: {
    outDir: 'dist',
    sourcemap: true,
  },

  // No `test` block. Web unit tests are the `web-unit` project in
  // tests/vitest.config.ts, and they resolve `@/*` through tests/tsconfig.json.
  // The old block here pointed at ./src/test/setup.ts and an e2e/ directory,
  // neither of which exists since the suite moved.
});
