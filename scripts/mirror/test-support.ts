// Shared by the mirror's tests: the project CSS built from the committed
// snapshots, and a compiler over it, as `mirror build` uses them.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { forStyle, parseConfig } from './config.ts'
import { type BaseColor, type FontItem, projectCss, type StyleIndex } from './project-css.ts'
import { registrations } from './scss.ts'
import { compileCandidates } from './tailwind.ts'

export const root = process.cwd()
// As parsed, with {style} in its output paths
export const parsed = parseConfig(
  JSON.parse(readFileSync(join(root, 'mirror.config.json'), 'utf8')),
)
// The first style's, as `mirror build` resolves it
export const config = forStyle(parsed, parsed.upstream.style)

export function snapshot<T>(name: string): T {
  const path = join(root, config.snapshotDir, config.upstream.style, `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

export const input = projectCss(
  snapshot<StyleIndex>('index'),
  snapshot<BaseColor>(`colors-${config.theme.baseColor}`),
  snapshot<FontItem>(`font-${config.theme.font}`),
)

export const compile = (candidates: string[]) => compileCandidates(input, candidates)

// The internal variables' defaults, as `mirror build` gathers them over every
// mirrored class: enough utilities here to register each one the tests use.
export const internalDefaults = registrations(
  await compile([
    ...['border', 'ring-3', 'shadow-xs', 'translate-y-px', 'leading-none', 'animate-in'],
    ...['content-[""]', 'duration-200', 'ease-in-out'],
  ]),
)
