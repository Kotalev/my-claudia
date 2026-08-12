import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // The frontend imports the server's type declarations directly rather than
  // keeping a hand-written copy. Types are erased at build time, so nothing
  // from src/ actually ships in the bundle.
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../src/shared', import.meta.url)),
      '@transcript': fileURLToPath(new URL('../src/transcript', import.meta.url)),
      '@tasks': fileURLToPath(new URL('../src/tasks', import.meta.url)),
      '@server': fileURLToPath(new URL('../src/server', import.meta.url)),
    },
  },
  plugins: [react(), tailwind()],
  server: {
    host: '127.0.0.1',
    port: 4518,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4517', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:4517', ws: true },
    },
  },
  build: { outDir: fileURLToPath(new URL('./dist', import.meta.url)), emptyOutDir: true },
})
