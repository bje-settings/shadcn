// Entry point for `pnpm mirror:*`; the logic lives in cli.ts.

import { run } from './cli.ts'
import { formatWithBiome } from './format.ts'

const root = process.cwd()

await run(process.argv.slice(2), {
  root,
  fetch: (url) => fetch(url),
  log: (message) => console.log(message),
  format: (path, content) => formatWithBiome(root, path, content),
}).catch((error: Error) => {
  console.error(error.message)
  process.exitCode = 1
})
