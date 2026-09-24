import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Io, run } from './cli.ts'

const upstream = {
  name: 'badge',
  type: 'registry:ui',
  files: [
    {
      path: 'registry/base-vega/ui/badge.tsx',
      type: 'registry:ui',
      content: [
        'import { cva } from "class-variance-authority"',
        'import { cn } from "cn"',
        'const badgeVariants = cva("group flex")',
        'function Badge({ c }) {',
        '  return <i data-slot="badge" className={cn(badgeVariants({ className: c }))} />',
        '}',
        'export { Badge }',
      ].join('\n'),
    },
  ],
}

let root: string
let logs: string[]
let requests: string[]

function io(status = 200): Io {
  return {
    root,
    fetch: async (url) => {
      requests.push(url)
      return { ok: status === 200, status, json: async () => upstream }
    },
    log: (message) => logs.push(message),
    format: (_, content) => content,
  }
}

const read = async (path: string) => readFile(join(root, path), 'utf8')

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mirror-'))
  logs = []
  requests = []
  await writeFile(
    join(root, 'mirror.config.json'),
    JSON.stringify({
      upstream: { url: 'https://example.com/{style}/{name}.json', style: 'base-vega' },
      components: ['badge'],
      snapshotDir: 'upstream',
      outputDir: 'registry/ui',
    }),
  )
  await writeFile(
    join(root, 'registry.json'),
    JSON.stringify({ name: 'bje', items: [{ name: 'cn' }] }),
  )
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('mirror fetch', () => {
  it('snapshots each configured item', async () => {
    await run(['fetch'], io())
    expect(requests).toEqual(['https://example.com/base-vega/badge.json'])
    expect(JSON.parse(await read('upstream/base-vega/badge.json'))).toEqual(upstream)
    expect(logs).toEqual(['fetched base-vega/badge'])
  })

  it('fails on an HTTP error', async () => {
    await expect(run(['fetch'], io(404))).rejects.toThrow(
      'GET https://example.com/base-vega/badge.json: 404',
    )
  })
})

describe('mirror build', () => {
  it('generates files from snapshots and upserts registry.json', async () => {
    await run(['fetch'], io())
    await run(['build'], io())
    expect(await read('registry/ui/Badge/Badge.tsx')).toContain('badgeVariants({ className: c })')
    expect(await read('registry/ui/Badge/Badge.test.tsx')).toContain('describe("Badge"')
    expect(await read('registry/ui/Badge/Badge.module.scss')).toContain(':where(.badge) {')
    const registry = JSON.parse(await read('registry.json'))
    expect(registry.items.map((item: { name: string }) => item.name)).toEqual(['cn', 'badge'])
    expect(logs.slice(1)).toEqual([
      'built badge: registry/ui/Badge/Badge.tsx, registry/ui/Badge/Badge.module.scss, registry/ui/Badge/Badge.test.tsx',
      '  badge: no CSS for group',
    ])
  })

  it('asks for a fetch when a snapshot is missing', async () => {
    await expect(run(['build'], io())).rejects.toThrow(
      'no snapshot for base-vega/badge; run mirror fetch first',
    )
  })
})

describe('usage', () => {
  it.each([[[]], [['sync']], [['build', 'extra']]])('rejects %j', async (args) => {
    await expect(run(args, io())).rejects.toThrow('usage: mirror <fetch|build>')
  })
})
