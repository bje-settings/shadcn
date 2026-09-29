// What `pnpm build` runs: `shadcn build` once per style, each style's catalog
// into its own directory of the site, so each is a flat registry under
// /<style>/.

import { forStyle, type MirrorConfig, shortStyle } from './config.ts'

export type RegistryBuild = { registry: string; output: string }

export function registryBuilds(config: MirrorConfig, outputRoot: string): RegistryBuild[] {
  return config.upstream.styles.map((style) => ({
    registry: forStyle(config, style).registryFile,
    output: `${outputRoot}/${shortStyle(style)}`,
  }))
}
