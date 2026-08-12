import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'

// The API server requires ?token= (persisted in .auth-token at the repo root),
// so the printed dev URL must carry it to be directly openable. Read lazily:
// the server may still be creating the file when Vite boots.
function tokenInPrintedUrl(): Plugin {
  return {
    name: 'token-in-printed-url',
    configureServer(server) {
      const printUrls = server.printUrls
      server.printUrls = () => {
        try {
          const token = readFileSync(
            fileURLToPath(new URL('../.auth-token', import.meta.url)), 'utf8').trim()
          if (server.resolvedUrls) {
            server.resolvedUrls.local =
              server.resolvedUrls.local.map(u => `${u}?token=${token}`)
          }
        } catch {
          // No token file yet — print the plain URL rather than fail.
        }
        printUrls()
      }
    },
  }
}

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
  plugins: [react(), tailwind(), tokenInPrintedUrl()],
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
