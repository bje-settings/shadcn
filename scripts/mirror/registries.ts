// What `pnpm build` runs: `shadcn build` once per style, each style's catalog
// into its own directory of the site, so each is a flat registry under
// /<style>/. And what `pnpm build:showcase` runs: each style's showcase page
// into the same directory, then the site's root page.

import { relative } from 'node:path'
import { builtStyles, forStyle, harnessStyle, type MirrorConfig } from './config.ts'

export type RegistryBuild = { registry: string; output: string }

export function registryBuilds(config: MirrorConfig, outputRoot: string): RegistryBuild[] {
  return builtStyles(config).map((style) => ({
    registry: forStyle(config, style).registryFile,
    output: `${outputRoot}/${style.name}`,
  }))
}

// A process to run: the program, its arguments, and what it adds to the
// environment.
export type Command = { command: string; args: string[]; env: Record<string, string> }

// The A/B harness's Vite root, which Vite resolves --outDir from.
const VITE_ROOT = 'ab'

// A Vite build of one site page, by its mode in ab/vite.config.ts, into
// `output`, for the style AB_STYLE names (the style the Vite config resolves).
function viteBuild(mode: 'showcase' | 'site', output: string, short: string): Command {
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
    ...builtStyles(config).flatMap(({ name }) => [
      { command: 'pnpm', args: ['mirror:build', name], env: { AB_STYLE: name } },
      viteBuild('showcase', `${outputRoot}/${name}`, name),
    ]),
    viteBuild('site', outputRoot, harnessStyle(config, undefined).name),
  ]
}
