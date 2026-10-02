// Entry point for `pnpm install-check [dir]`; the logic lives in check.ts.
// Checks the first style in upstream.styles, from public/r/<style> or dir.

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseConfig, shortStyle } from '../mirror/config.ts'
import { run } from './check.ts'

const root = process.cwd()
const config = parseConfig(JSON.parse(readFileSync('mirror.config.json', 'utf8')))
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const style = config.upstream.style
// pnpm passes its own npm configuration to scripts as npm_config_*, which would
// override the scratch project's .npmrc.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith('npm_config_')),
)

await run({
  root,
  registryDir: process.argv[2] ?? `public/r/${shortStyle(style)}`,
  project: mkdtempSync(join(tmpdir(), 'install-check-')),
  style,
  versions: { ...pkg.dependencies, ...pkg.devDependencies },
  exec: (command, args, cwd) =>
    new Promise((done, failed) => {
      spawn(command, args, { cwd, env, stdio: 'inherit' })
        .on('error', failed)
        .on('close', (code) =>
          code === 0 ? done() : failed(new Error(`${command} ${args.join(' ')} exited ${code}`)),
        )
    }),
  log: (message) => console.log(message),
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
