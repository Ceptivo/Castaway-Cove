import { defineConfig } from 'vite';

export default defineConfig({
  // Relative paths so the same build runs from a web host and inside the
  // Capacitor Android app.
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
  server: { port: 5173 },
});
