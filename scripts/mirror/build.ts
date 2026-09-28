// Entry point for `pnpm build`; the logic lives in registries.ts.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parseConfig } from './config.ts'
import { registryBuilds } from './registries.ts'

const config = parseConfig(JSON.parse(readFileSync('mirror.config.json', 'utf8')))
for (const { registry, output } of registryBuilds(config, 'public/r')) {
  execFileSync('pnpm', ['exec', 'shadcn', 'build', registry, '--output', output], {
    stdio: 'inherit',
  })
}
