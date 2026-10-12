// What `pnpm build` runs: `shadcn build` once per style, each style's catalog
// into its own directory of the site, so each is a flat registry under
// /<style>/; then each style's showcase page into the same directory.

import { relative } from 'node:path'
import { forStyle, type MirrorConfig, shortStyle } from './config.ts'

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

// The showcase builds, style after style: the style's harness inputs, which
// git does not track, then a Vite build of its showcase as index.html beside
// its registry. AB_STYLE picks the style the Vite config resolves.
export function showcaseBuilds(config: MirrorConfig, outputRoot: string): Command[] {
  return config.upstream.styles.flatMap((style) => {
    const short = shortStyle(style)
    const env = { AB_STYLE: short }
    const outDir = relative(VITE_ROOT, `${outputRoot}/${short}`)
    return [
      { command: 'pnpm', args: ['mirror:build', short], env },
      {
        command: 'pnpm',
        args: [
          'exec',
          'vite',
          'build',
          '--config',
          `${VITE_ROOT}/vite.config.ts`,
          '--mode',
          'showcase',
          '--outDir',
          outDir,
        ],
        env,
      },
    ]
  })
}
