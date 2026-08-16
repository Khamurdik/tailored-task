/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vitest/config';

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
    // Mirrors the Vercel rewrite the deployment plan prefers: the API is
    // same-origin in dev too, so the refresh cookie stays first-party and
    // SameSite=Lax works identically in dev and prod. See apps/api/src/auth.
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

  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    // Playwright owns everything under e2e/; Vitest must not try to run it.
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['**/*.config.*', '**/dist/**', 'src/test/**'],
    },
  },
});
