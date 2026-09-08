import { defineConfig } from 'vite';

// The dev port can be assigned by the harness via PORT; fall back to Vite's default.
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const port = Number(env?.PORT) || 5173;

export default defineConfig({
  base: './',
  server: { host: true, port },
  preview: { host: true, port },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
});
