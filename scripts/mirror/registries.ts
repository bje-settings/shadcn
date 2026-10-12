// What `pnpm build` runs: `shadcn build` once per style, each style's catalog
// into its own directory of the site, so each is a flat registry under
// /<style>/. And what `pnpm build:showcase` runs: each style's showcase page
// into the same directory, then the site's root page.

import { relative } from 'node:path'
import { forStyle, harnessStyle, type MirrorConfig, shortStyle } from './config.ts'

export type RegistryBuild = { registry: string; output: string }

export function registryBuilds(config: MirrorConfig, outputRoot: string): RegistryBuild[] {
  return config.upstream.styles.map((style) => ({
    registry: forStyle(config, style).registryFile,
    output: `${outputRoot}/${shortStyle(style)}`,
  }))
}

// A process to run: the program, its arguments, and what it adds to the
// environment.
export type Command = { command: string; args: string[]; env: Record<string, string> }

// The A/B harness's Vite root, which Vite resolves --outDir from.
const VITE_ROOT = 'ab'

// A Vite build of the harness in `mode`, into `output`, for the style AB_STYLE
// names (the style the Vite config resolves).
function viteBuild(mode: string, output: string, short: string): Command {
  return {
    command: 'pnpm',
    args: [
      'exec',
      'vite',
      'build',
      '--config',
      `${VITE_ROOT}/vite.config.ts`,
      '--mode',
      mode,
      '--outDir',
      relative(VITE_ROOT, output),
    ],
    env: { AB_STYLE: short },
  }
}

// The showcase builds, style after style: the style's harness inputs, which
// git does not track, then a Vite build of its showcase as index.html beside
// its registry. Last, the root page as the site's index.html, with the A/B
// default style's inputs: each style's `mirror:build` writes only its own
// ab/generated/<style>/, so the first style's are still in place.
export function showcaseBuilds(config: MirrorConfig, outputRoot: string): Command[] {
  return [
    ...config.upstream.styles.flatMap((style) => {
      const short = shortStyle(style)
      return [
        { command: 'pnpm', args: ['mirror:build', short], env: { AB_STYLE: short } },
        viteBuild('showcase', `${outputRoot}/${short}`, short),
      ]
    }),
    viteBuild('site', outputRoot, shortStyle(harnessStyle(config, undefined))),
  ]
}
