// Serves the A/B pages: upstream.html (Tailwind), ours.html (SCSS modules) and
// index.html (both side by side). Aliases mirror each side's registry imports.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const repo = fileURLToPath(new URL('..', import.meta.url))
const ab = fileURLToPath(new URL('.', import.meta.url))
const config = JSON.parse(readFileSync(`${repo}mirror.config.json`, 'utf8'))

export default defineConfig({
  root: ab,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      [`@/registry/${config.namespace}/ui`]: `${repo}registry/ui`,
      [`@/registry/${config.upstream.style}/ui`]: `${ab}generated/upstream`,
    },
  },
  server: { fs: { allow: [repo] } },
  build: {
    rollupOptions: {
      input: {
        index: `${ab}index.html`,
        upstream: `${ab}upstream.html`,
        ours: `${ab}ours.html`,
      },
    },
  },
})
