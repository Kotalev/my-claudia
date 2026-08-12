import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
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
