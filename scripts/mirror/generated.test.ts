// The committed output must be exactly what the pipeline produces from the
// committed snapshots: a hand edit to a generated file, or a pipeline change
// without `pnpm mirror:build`, fails here. Also proves every generated module
// compiles with Sass.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compile } from 'sass'
import { describe, expect, it } from 'vitest'
import { buildComponent, type UpstreamItem } from './component.ts'
import { parseConfig } from './config.ts'
import { formatWithBiome } from './format.ts'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')
const config = parseConfig(JSON.parse(read('mirror.config.json')))
const registry = JSON.parse(read('registry.json'))

describe.each(config.components)('generated %s', (name) => {
  it('matches the pipeline output', async () => {
    const snapshot = JSON.parse(read(`${config.snapshotDir}/${config.upstream.style}/${name}.json`))
    const component = await buildComponent(snapshot as UpstreamItem, config)
    for (const file of component.files) {
      expect(read(file.path), file.path).toBe(formatWithBiome(root, file.path, file.content))
    }
    expect(registry.items.find((item: { name: string }) => item.name === name)).toEqual(
      component.item,
    )
  })

  it('compiles with Sass', async () => {
    const snapshot = JSON.parse(read(`${config.snapshotDir}/${config.upstream.style}/${name}.json`))
    const { files } = await buildComponent(snapshot as UpstreamItem, config)
    for (const file of files.filter((f) => f.path.endsWith('.scss'))) {
      expect(compile(join(root, file.path)).css).toContain(':where(')
    }
  })
})
