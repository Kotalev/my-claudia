import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@transcript': fileURLToPath(new URL('./src/transcript', import.meta.url)),
      '@tasks': fileURLToPath(new URL('./src/tasks', import.meta.url)),
    },
  },
})
