import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      input: path.resolve(import.meta.dirname, 'scroll-stability.html'),
    },
  },
  plugins: [tailwindcss(), svelte()],
  resolve: {
    alias: {
      $lib: path.resolve(import.meta.dirname, 'src/lib'),
    },
  },
  server: {
    allowedHosts: true,
  },
})
