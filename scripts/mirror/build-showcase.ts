// Entry point for `pnpm build:showcase`; the logic lives in registries.ts.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parseConfig } from './config.ts'
import { showcaseBuilds } from './registries.ts'

const config = parseConfig(JSON.parse(readFileSync('mirror.config.json', 'utf8')))
for (const { command, args, env } of showcaseBuilds(config, 'public/r')) {
  execFileSync(command, args, { stdio: 'inherit', env: { ...process.env, ...env } })
}
