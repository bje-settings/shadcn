import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Io, run } from './cli.ts'
import { snapshot } from './test-support.ts'

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

// What each upstream URL serves: the component above, and the real style
// index, font and base color snapshots.
const responses: Record<string, unknown> = {
  'https://example.com/base-vega/badge.json': upstream,
  'https://example.com/base-vega/index.json': snapshot('index'),
  'https://example.com/base-vega/font-inter.json': snapshot('font-inter'),
  'https://example.com/colors/neutral.json': snapshot('colors-neutral'),
}

let root: string
let logs: string[]
let requests: string[]

function io(status = 200): Io {
  return {
    root,
    fetch: async (url) => {
      requests.push(url)
      return { ok: status === 200, status, json: async () => responses[url] }
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
      namespace: 'bje',
      upstream: {
        url: 'https://example.com/{style}/{name}.json',
        colorsUrl: 'https://example.com/colors/{name}.json',
        style: 'base-vega',
      },
      theme: { baseColor: 'neutral', font: 'inter' },
      components: ['badge'],
      snapshotDir: 'upstream',
      outputDir: 'registry/ui',
      globalsDir: 'registry/styles',
      harnessDir: 'ab/generated',
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
  it('snapshots each configured item and the theme sources', async () => {
    await run(['fetch'], io())
    expect(requests).toEqual(Object.keys(responses))
    expect(JSON.parse(await read('upstream/base-vega/badge.json'))).toEqual(upstream)
    expect(JSON.parse(await read('upstream/base-vega/colors-neutral.json'))).toEqual(
      snapshot('colors-neutral'),
    )
    expect(logs).toEqual([
      'fetched base-vega/badge',
      'fetched base-vega/index',
      'fetched base-vega/font-inter',
      'fetched base-vega/colors-neutral',
    ])
  })

  it('fails on an HTTP error', async () => {
    await expect(run(['fetch'], io(404))).rejects.toThrow(
      'GET https://example.com/base-vega/badge.json: 404',
    )
  })
})

describe('mirror build', () => {
  it('generates components, globals and harness inputs, and upserts registry.json', async () => {
    await run(['fetch'], io())
    logs = []
    await run(['build'], io())
    expect(await read('upstream/base-vega/index.css')).toContain('@import "tailwindcss";')
    expect(await read('registry/ui/Badge/Badge.tsx')).toContain('badgeVariants({ className: c })')
    expect(await read('registry/ui/Badge/Badge.test.tsx')).toContain('describe("Badge"')
    expect(await read('registry/ui/Badge/Badge.module.scss')).toContain(':where(.badge) {')
    expect(await read('registry/styles/variables.scss')).toContain('--background: oklch(100% 0 0);')
    expect(await read('registry/styles/base.scss')).toContain('@layer base {')
    expect(await read('ab/generated/ours.ts')).toContain('@/registry/bje/ui/Badge/Badge')
    const registry = JSON.parse(await read('registry.json'))
    expect(registry.items.map((item: { name: string }) => item.name)).toEqual([
      'cn',
      'badge',
      'globals',
    ])
    expect(registry.items[2]).toEqual({
      name: 'globals',
      type: 'registry:file',
      title: 'Globals',
      dependencies: ['@fontsource-variable/inter'],
      devDependencies: [],
      registryDependencies: [],
      files: [
        {
          path: 'registry/styles/variables.scss',
          type: 'registry:file',
          target: '@components/styles/variables.scss',
        },
        {
          path: 'registry/styles/base.scss',
          type: 'registry:file',
          target: '@components/styles/base.scss',
        },
      ],
    })
    expect(logs).toEqual([
      'built badge: registry/ui/Badge/Badge.tsx, registry/ui/Badge/Badge.module.scss, registry/ui/Badge/Badge.test.tsx',
      '  badge: no CSS for group',
      'built globals: registry/styles/variables.scss, registry/styles/base.scss',
      'built A/B harness inputs in ab/generated',
    ])
  })

  it('asks for a fetch when a snapshot is missing', async () => {
    await expect(run(['build'], io())).rejects.toThrow(
      'no snapshot for base-vega/font-inter; run mirror fetch first',
    )
  })
})

describe('usage', () => {
  it.each([[[]], [['sync']], [['build', 'extra']]])('rejects %j', async (args) => {
    await expect(run(args, io())).rejects.toThrow('usage: mirror <fetch|build>')
  })
})
