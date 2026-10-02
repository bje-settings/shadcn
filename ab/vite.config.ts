// Serves the A/B pages: upstream.html (Tailwind), ours.html (SCSS modules) and
// index.html (both side by side). Aliases mirror each side's registry imports,
// for the style ab/style.ts picks.

import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { config, port, repo } from './style.ts'

const ab = fileURLToPath(new URL('.', import.meta.url))
const { namespace, upstream } = config
const generated = `${repo}${config.harnessDir}`

export default defineConfig({
  root: ab,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@ab/generated': generated,
      '@ab/styles': `${repo}${config.globalsDir}`,
      [`@/registry/${namespace}/ui`]: `${repo}${config.outputDir}`,
      [`@/registry/${namespace}/hooks`]: `${repo}${config.hooksDir}`,
      [`@/registry/${upstream.style}/ui`]: `${generated}/upstream`,
      [`@/registry/${upstream.style}/hooks`]: `${generated}/upstream/hooks`,
      // Docs-only imports in upstream's examples, replaced by stand-ins.
      [`@/registry/${upstream.style}/components/example`]: `${ab}stubs/example.tsx`,
      '@/app/(create)/components/icon-placeholder': `${ab}stubs/icon-placeholder.tsx`,
    },
  },
  // Console output stays in the browser: the A/B spec reads it there, and
  // forwarding every page's messages to the server slows a parallel run. The
  // port is the style's, and strict: falling back to the next one would take
  // another style's.
  server: { port, strictPort: true, fs: { allow: [repo] }, forwardConsole: false },
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
