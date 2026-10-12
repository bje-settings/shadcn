// Serves the A/B pages: upstream.html (Tailwind), ours.html (SCSS modules) and
// index.html (both side by side), and the showcase (showcase.html). Aliases
// mirror each side's registry imports, for the style ab/style.ts picks.
// `--mode showcase` builds the showcase alone, as the site's index.html for
// the style, into the --outDir `pnpm build:showcase` passes.

import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { CREATE_STUBS } from '../scripts/mirror/examples.ts'
import { config, port, repo, short } from './style.ts'

const ab = fileURLToPath(new URL('.', import.meta.url))
const { namespace, upstream } = config
const generated = `${repo}${config.harnessDir}`

// The showcase names its style in its title and in the marker CI's build and
// deploy checks look for.
const styleName: Plugin = {
  name: 'showcase-style',
  transformIndexHtml: (html) => html.replaceAll('{style}', short),
}

// Vite names an HTML output after its source; the site serves the showcase as
// the style directory's index.
const showcaseIndex: Plugin = {
  name: 'showcase-index',
  apply: 'build',
  // After Vite's own HTML plugin has emitted the page.
  enforce: 'post',
  generateBundle(_, bundle) {
    const page = bundle['showcase.html']
    if (page === undefined) {
      throw new Error(`showcase-index: no showcase.html in ${Object.keys(bundle).join(', ')}`)
    }
    page.fileName = 'index.html'
  },
}

export default defineConfig(({ mode }) => {
  const showcase = mode === 'showcase'
  return {
    root: ab,
    // Relative in the showcase build, so the page loads its assets under the
    // style's path on the site (/vega/).
    base: showcase ? './' : '/',
    plugins: [react(), tailwindcss(), styleName, ...(showcase ? [showcaseIndex] : [])],
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
        'next/image': `${ab}stubs/next-image.tsx`,
        'next/link': `${ab}stubs/next-link.tsx`,
        // The /create internals the showcase's cards import.
        ...Object.fromEntries(
          Object.entries(CREATE_STUBS).map(([specifier, stub]) => [specifier, `${repo}${stub}`]),
        ),
      },
    },
    // Console output stays in the browser: the A/B spec reads it there, and
    // forwarding every page's messages to the server slows a parallel run. The
    // port is the style's, and strict: falling back to the next one would take
    // another style's.
    server: { port, strictPort: true, fs: { allow: [repo] }, forwardConsole: false },
    build: {
      // The showcase's out dir already holds the style's registry JSON.
      ...(showcase ? { emptyOutDir: false } : {}),
      rollupOptions: {
        input: {
          ...(showcase
            ? {}
            : { index: `${ab}index.html`, upstream: `${ab}upstream.html`, ours: `${ab}ours.html` }),
          showcase: `${ab}showcase.html`,
        },
      },
    },
  }
})
