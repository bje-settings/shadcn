// The committed output must be exactly what `mirror build` produces from the
// committed snapshots: a hand edit to a generated file, or a pipeline change
// without `pnpm mirror:build`, fails here. Covers, for every style, components,
// hooks, global stylesheets, the rebuilt project CSS, registry catalog and
// tsconfig, and proves every generated stylesheet compiles with Sass.

import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { compile } from 'sass'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { run } from './cli.ts'
import { forStyle } from './config.ts'
import { formatWithBiome } from './format.ts'
import { parsed, root } from './test-support.ts'

const styles = parsed.upstream.styles.map((style) => forStyle(parsed, style))
const snapshotDirs = styles.map((config) => join(config.snapshotDir, config.upstream.style))
// The A/B harness inputs are not committed (see .gitignore): pnpm ab
// regenerates them.
const outputDirs = styles.flatMap((config) => [
  config.outputDir,
  config.hooksDir,
  config.globalsDir,
])
let built: string

async function files(base: string, dir: string): Promise<string[]> {
  const entries = await readdir(join(base, dir), { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(base, join(entry.parentPath, entry.name)))
    .sort()
}

// Builds every style: allow for the whole suite running alongside.
beforeAll(async () => {
  built = await mkdtemp(join(tmpdir(), 'mirror-generated-'))
  for (const path of ['mirror.config.json', 'registry.json']) {
    await cp(join(root, path), join(built, path))
  }
  for (const snapshots of snapshotDirs) {
    for (const path of await files(root, snapshots)) {
      if (path.endsWith('.json')) await cp(join(root, path), join(built, path), { recursive: true })
    }
  }
  const typeset = join(parsed.snapshotDir, 'typeset')
  await cp(join(root, typeset), join(built, typeset), { recursive: true })
  await run(['build'], {
    root: built,
    fetch: () => Promise.reject(new Error('build must not fetch')),
    log: () => {},
    format: (path, content) => formatWithBiome(root, path, content),
  })
}, 180_000)

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
      ...snapshotDirs.map((snapshots) => join(snapshots, 'index.css')),
      ...styles.flatMap(({ registryFile }) => [
        registryFile,
        join(dirname(registryFile), 'tsconfig.json'),
      ]),
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
