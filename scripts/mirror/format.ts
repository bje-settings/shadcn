// Formats generated files and applies Biome's safe fixes (import order,
// `import type`, and the rules biome.json sets to `fix: "safe"`) with the
// repo's own Biome config, so what the mirror writes is exactly what `biome ci`
// accepts and a regenerated file only differs from the committed one when the
// conversion changed. Biome formats stdin whatever `files.includes` says, and
// exits 0 whatever its linter finds there: this formats, `biome ci` gates.

import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export function formatWithBiome(root: string, path: string, content: string): string {
  return execFileSync(
    join(root, 'node_modules', '.bin', 'biome'),
    ['check', '--write', `--stdin-file-path=${path}`],
    { cwd: root, input: content, encoding: 'utf8' },
  )
}
