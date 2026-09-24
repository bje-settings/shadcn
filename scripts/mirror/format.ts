// Formats generated files and applies Biome's safe fixes (import order,
// `import type`) with the repo's own Biome config, so what the mirror writes
// is exactly what `biome ci` accepts and a regenerated file only differs from
// the committed one when the conversion changed. Stylesheets are
// outside Biome's scope here (and use Tailwind directives it cannot parse) and
// pass through untouched.

import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export function formatWithBiome(root: string, path: string, content: string): string {
  if (/\.s?css$/.test(path)) return content
  return execFileSync(
    join(root, 'node_modules', '.bin', 'biome'),
    ['check', '--write', `--stdin-file-path=${path}`],
    { cwd: root, input: content, encoding: 'utf8' },
  )
}
