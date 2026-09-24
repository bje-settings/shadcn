// Formats generated files with the repo's own Biome config, so what the
// mirror writes is exactly what `biome ci` accepts and a regenerated file only
// differs from the committed one when the conversion changed. SCSS is outside
// Biome's scope here and passes through untouched.

import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export function formatWithBiome(root: string, path: string, content: string): string {
  if (path.endsWith('.scss')) return content
  return execFileSync(
    join(root, 'node_modules', '.bin', 'biome'),
    ['format', `--stdin-file-path=${path}`],
    { cwd: root, input: content, encoding: 'utf8' },
  )
}
