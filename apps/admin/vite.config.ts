/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Les variables VITE_* sont lues dans le .env de la racine du dépôt (seules celles-ci sont exposées au navigateur).
export default defineConfig({
  envDir: '../..',
  plugins: [react()],
  server: {
    port: 5174,
    // Même origine qu'en production (sous-domaine du panel) : le cookie de session (chemin /v1/auth) fonctionne sans CORS
    proxy: { '/v1': { target: process.env.API_URL ?? 'http://localhost:3100', changeOrigin: false } },
  },
  build: { sourcemap: false, target: 'es2022' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
