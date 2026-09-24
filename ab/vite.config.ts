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
      [`@/registry/${config.namespace}/hooks`]: `${repo}registry/hooks`,
      [`@/registry/${config.upstream.style}/ui`]: `${ab}generated/upstream`,
      [`@/registry/${config.upstream.style}/hooks`]: `${ab}generated/upstream/hooks`,
      // Docs-only imports in upstream's examples, replaced by stand-ins.
      [`@/registry/${config.upstream.style}/components/example`]: `${ab}stubs/example.tsx`,
      '@/app/(create)/components/icon-placeholder': `${ab}stubs/icon-placeholder.tsx`,
    },
  },
  // Console output stays in the browser: the A/B spec reads it there, and
  // forwarding every page's messages to the server slows a parallel run.
  server: { fs: { allow: [repo] }, forwardConsole: false },
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
