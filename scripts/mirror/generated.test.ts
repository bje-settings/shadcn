// The committed output must be exactly what `mirror build` produces from the
// committed snapshots: a hand edit to a generated file, or a pipeline change
// without `pnpm mirror:build`, fails here. Covers components, global
// stylesheets, A/B harness inputs, the rebuilt project CSS and registry.json,
// and proves every generated stylesheet compiles with Sass.

import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { compile } from 'sass'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { run } from './cli.ts'
import { formatWithBiome } from './format.ts'
import { config, root } from './test-support.ts'

const snapshots = join(config.snapshotDir, config.upstream.style)
const outputDirs = [config.outputDir, config.globalsDir, config.harnessDir]
let built: string

async function files(base: string, dir: string): Promise<string[]> {
  const entries = await readdir(join(base, dir), { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(base, join(entry.parentPath, entry.name)))
    .sort()
}

beforeAll(async () => {
  built = await mkdtemp(join(tmpdir(), 'mirror-generated-'))
  for (const path of ['mirror.config.json', 'registry.json']) {
    await cp(join(root, path), join(built, path))
  }
  for (const path of await files(root, snapshots)) {
    if (path.endsWith('.json')) await cp(join(root, path), join(built, path), { recursive: true })
  }
  await cp(join(root, config.snapshotDir, 'typeset'), join(built, config.snapshotDir, 'typeset'), {
    recursive: true,
  })
  await run(['build'], {
    root: built,
    fetch: () => Promise.reject(new Error('build must not fetch')),
    log: () => {},
    format: (path, content) => formatWithBiome(root, path, content),
  })
}, 60_000)

afterAll(async () => {
  await rm(built, { recursive: true, force: true })
})

describe('generated output', () => {
  it('commits exactly the files the pipeline generates', async () => {
    for (const dir of outputDirs) {
      expect(await files(root, dir), dir).toEqual(await files(built, dir))
    }
  })

  it('matches the pipeline output byte for byte', async () => {
    const paths = [
      'registry.json',
      join(snapshots, 'index.css'),
      ...(await Promise.all(outputDirs.map((dir) => files(built, dir)))).flat(),
    ]
    for (const path of paths) {
      expect(await readFile(join(root, path), 'utf8'), path).toBe(
        await readFile(join(built, path), 'utf8'),
      )
    }
  })

  it('compiles every generated stylesheet with Sass', async () => {
    const sheets = (await Promise.all(outputDirs.map((dir) => files(built, dir))))
      .flat()
      .filter((path) => path.endsWith('.scss'))
    expect(sheets.length).toBeGreaterThan(0)
    for (const path of sheets) expect(compile(join(built, path)).css, path).not.toBe('')
  })
})
