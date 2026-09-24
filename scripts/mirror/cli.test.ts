import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
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

const example = {
  name: 'badge-example',
  type: 'registry:example',
  files: [
    {
      path: 'registry/base-vega/examples/badge-example.tsx',
      type: 'registry:example',
      content: [
        'import { Badge } from "@/registry/base-vega/ui/badge"',
        'import { Other } from "@/registry/base-vega/ui/other"',
        'export default function BadgeExample() { return <><BadgeBasic /><BadgeOther /></> }',
        'function BadgeBasic() { return <Badge /> }',
        'function BadgeOther() { return <Other /> }',
      ].join('\n'),
    },
  ],
}

// What each upstream URL serves: the component and its example above, the
// real style index, font and base color snapshots, and a small Typeset
// stylesheet and fixture. Anything else is a 404.
let responses: Record<string, unknown>
const allResponses = {
  'https://example.com/base-vega/badge.json': upstream,
  'https://example.com/base-vega/index.json': snapshot('index'),
  'https://example.com/base-vega/font-inter.json': snapshot('font-inter'),
  'https://example.com/colors/neutral.json': snapshot('colors-neutral'),
  'https://example.com/base-vega/badge-example.json': example,
  'https://example.com/typeset.css':
    '@layer components { .typeset { color: var(--color-foreground); } }\n',
  'https://example.com/fixtures/docs.ts': 'export const DOCS_HTML = `<h1>Docs</h1>`\n',
}

let root: string
let logs: string[]
let requests: string[]

function io(status = 200): Io {
  return {
    root,
    fetch: async (url) => {
      requests.push(url)
      const found = url in responses
      return {
        ok: found && status === 200,
        status: found ? status : 404,
        json: async () => responses[url],
        text: async () => responses[url] as string,
      }
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
  responses = { ...allResponses }
  await writeFile(
    join(root, 'mirror.config.json'),
    JSON.stringify({
      namespace: 'bje',
      upstream: {
        url: 'https://example.com/{style}/{name}.json',
        colorsUrl: 'https://example.com/colors/{name}.json',
        style: 'base-vega',
      },
      theme: { baseColor: 'neutral', font: 'inter', iconLibrary: 'lucide' },
      components: ['badge'],
      typeset: {
        stylesheet: 'https://example.com/typeset.css',
        fixturesUrl: 'https://example.com/fixtures/{name}.ts',
        fixtures: ['docs'],
      },
      snapshotDir: 'upstream',
      outputDir: 'registry/ui',
      hooksDir: 'registry/hooks',
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
    expect(requests).toEqual(Object.keys(allResponses))
    expect(JSON.parse(await read('upstream/base-vega/badge.json'))).toEqual(upstream)
    expect(JSON.parse(await read('upstream/base-vega/colors-neutral.json'))).toEqual(
      snapshot('colors-neutral'),
    )
    expect(logs).toEqual([
      'fetched base-vega/badge',
      'fetched base-vega/index',
      'fetched base-vega/font-inter',
      'fetched base-vega/colors-neutral',
      'fetched base-vega/badge-example',
      'fetched typeset/typeset.css',
      'fetched typeset/fixtures/docs.ts',
    ])
    expect(await read('upstream/typeset/fixtures/docs.ts')).toBe(
      'export const DOCS_HTML = `<h1>Docs</h1>`\n',
    )
  })

  it('refuses an upstream item whose shape changed, before snapshotting it', async () => {
    responses['https://example.com/base-vega/font-inter.json'] = { font: { family: 'x' } }
    await expect(run(['fetch'], io())).rejects.toThrow(
      'https://example.com/base-vega/font-inter.json: font.variable must be a non-empty string',
    )
    await expect(stat(join(root, 'upstream/base-vega/font-inter.json'))).rejects.toThrow('ENOENT')
  })

  it('fails on a typeset HTTP error', async () => {
    delete responses['https://example.com/fixtures/docs.ts']
    await expect(run(['fetch'], io())).rejects.toThrow(
      'GET https://example.com/fixtures/docs.ts: 404',
    )
  })

  it('skips a component with no example, drops its old snapshot, and builds without one', async () => {
    await run(['fetch'], io())
    delete responses['https://example.com/base-vega/badge-example.json']
    await run(['fetch'], io())
    expect(logs).toContain('no badge-example upstream')
    await expect(stat(join(root, 'upstream/base-vega/badge-example.json'))).rejects.toThrow(
      'ENOENT',
    )
    await run(['build'], io())
    expect(await read('ab/generated/examples.ts')).toContain('export const examples = []')
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
    expect(await read('registry/styles/fonts.css')).toContain(
      '@import "@fontsource-variable/inter";',
    )
    expect(await read('registry/styles/typeset.css')).toBe(
      '/* Mirrored from https://example.com/typeset.css by scripts/mirror. Do not edit. */\n\n@layer components { .typeset { color: var(--color-foreground); } }\n',
    )
    expect(await read('registry/styles/variables.scss')).toContain(
      '--color-foreground: var(--foreground);',
    )
    expect(await read('ab/generated/ours.ts')).toContain('@/registry/bje/ui/Badge/Badge')
    expect(await read('ab/generated/typeset.ts')).toContain('<h1>Docs</h1>')
    const registry = JSON.parse(await read('registry.json'))
    expect(registry.items.map((item: { name: string }) => item.name)).toEqual([
      'cn',
      'badge',
      'globals',
      'typeset',
    ])
    expect(registry.items[2]).toEqual({
      name: 'globals',
      type: 'registry:file',
      title: 'Globals',
      dependencies: ['@fontsource-variable/inter'],
      devDependencies: ['sass'],
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
        {
          path: 'registry/styles/fonts.css',
          type: 'registry:file',
          target: '@components/styles/fonts.css',
        },
      ],
    })
    expect(registry.items[3]).toEqual({
      name: 'typeset',
      type: 'registry:file',
      title: 'Typeset',
      dependencies: [],
      devDependencies: [],
      registryDependencies: ['@bje/globals'],
      files: [
        {
          path: 'registry/styles/typeset.css',
          type: 'registry:file',
          target: '@components/styles/typeset.css',
        },
      ],
    })
    expect(logs).toEqual([
      'built badge: registry/ui/Badge/Badge.tsx, registry/ui/Badge/Badge.module.scss, registry/ui/Badge/Badge.test.tsx',
      '  badge: no CSS for group',
      'built globals: registry/styles/variables.scss, registry/styles/base.scss, registry/styles/fonts.css',
      'built typeset: registry/styles/typeset.css',
      'example badge-example: 1 of 2 sub-examples',
      '  skipped BadgeOther: needs other',
      'built A/B harness inputs in ab/generated',
    ])
    expect(await read('ab/generated/examples/ours/badge-example.tsx')).toContain(
      'import { Badge } from "@/registry/bje/ui/Badge/Badge"',
    )
  })

  it('asks for a fetch when a snapshot is missing', async () => {
    await expect(run(['build'], io())).rejects.toThrow(
      'no snapshot for base-vega/font-inter; run mirror fetch first',
    )
  })

  it('names a corrupt snapshot rather than asking for a fetch', async () => {
    await run(['fetch'], io())
    await writeFile(join(root, 'upstream/base-vega/badge-example.json'), '{ nope')
    await expect(run(['build'], io())).rejects.toThrow(
      /upstream\/base-vega\/badge-example\.json: .*JSON/,
    )
  })

  it('refuses an example snapshot without content', async () => {
    await run(['fetch'], io())
    const path = join(root, 'upstream/base-vega/badge-example.json')
    await writeFile(path, JSON.stringify({ ...example, files: [{ path: 'x', type: 'y' }] }))
    await expect(run(['build'], io())).rejects.toThrow(
      'no snapshot for base-vega/badge-example content',
    )
  })

  it('propagates read errors other than a missing file', async () => {
    await run(['fetch'], io())
    await rm(join(root, 'upstream/typeset/typeset.css'))
    await mkdir(join(root, 'upstream/typeset/typeset.css'))
    await expect(run(['build'], io())).rejects.toThrow('EISDIR')
  })

  it('drops the registry item of a component no longer configured', async () => {
    await writeFile(
      join(root, 'registry.json'),
      JSON.stringify({
        name: 'bje',
        items: [
          { name: 'cn', files: [{ path: 'registry/lib/cn.ts' }] },
          { name: 'old', files: [{ path: 'registry/ui/Old/Old.tsx' }] },
          { name: 'bare' },
        ],
      }),
    )
    await run(['fetch'], io())
    await run(['build'], io())
    const registry = JSON.parse(await read('registry.json'))
    expect(registry.items.map((item: { name: string }) => item.name)).toEqual([
      'cn',
      'bare',
      'badge',
      'globals',
      'typeset',
    ])
  })

  it('asks for a fetch when the typeset snapshot is missing', async () => {
    await run(['fetch'], io())
    await rm(join(root, 'upstream/typeset'), { recursive: true })
    await expect(run(['build'], io())).rejects.toThrow(
      'no snapshot for typeset/typeset.css; run mirror fetch first',
    )
  })
})

describe('usage', () => {
  it.each([[[]], [['sync']], [['build', 'extra']]])('rejects %j', async (args) => {
    await expect(run(args, io())).rejects.toThrow('usage: mirror <fetch|build>')
  })
})
