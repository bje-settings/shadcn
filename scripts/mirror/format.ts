// Formats generated files, stylesheets included, and applies Biome's safe
// fixes (import order, `import type`, and the rules biome.json sets to
// `fix: "safe"`) with the repo's own Biome config, so what the mirror writes
// is in the format `biome ci` checks and a regenerated file only differs from
// the committed one when the conversion changed. It is not a lint gate: Biome
// exits 0 here whatever its linter finds. It returns an existing file that
// `files.includes` does not cover unchanged, so that list names every
// extension the mirror writes.

import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export function formatWithBiome(root: string, path: string, content: string): string {
  return execFileSync(
    join(root, 'node_modules', '.bin', 'biome'),
    ['check', '--write', `--stdin-file-path=${path}`],
    { cwd: root, input: content, encoding: 'utf8' },
  )
}
