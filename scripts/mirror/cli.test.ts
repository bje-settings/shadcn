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

// What each upstream URL serves, for both styles: the component and its
// example above, the real style index, font and base color snapshots, and a
// small Typeset stylesheet and fixture. Anything else is a 404.
let responses: Record<string, unknown>
const styleResponses = (style: string) => ({
  [`https://example.com/${style}/badge.json`]: upstream,
  [`https://example.com/${style}/index.json`]: snapshot('index'),
  [`https://example.com/${style}/font-inter.json`]: snapshot('font-inter'),
  'https://example.com/colors/neutral.json': snapshot('colors-neutral'),
  [`https://example.com/${style}/badge-example.json`]: example,
})
const allResponses = {
  ...styleResponses('base-vega'),
  ...styleResponses('base-luma'),
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

// A build compiles every style's classes with Tailwind, which takes longer than
// vitest's default timeout on CI's runners.
const BUILDS = { timeout: 30_000 }

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
        styles: ['base-vega', 'base-luma'],
        compare: 'base-vega',
      },
      theme: { baseColor: 'neutral', font: 'inter', iconLibrary: 'lucide' },
      components: ['badge'],
      typeset: {
        stylesheet: 'https://example.com/typeset.css',
        fixturesUrl: 'https://example.com/fixtures/{name}.ts',
        fixtures: ['docs'],
      },
      snapshotDir: 'upstream',
      outputDir: 'registry/{style}/ui',
      hooksDir: 'registry/{style}/hooks',
      globalsDir: 'registry/{style}/styles',
      harnessDir: 'ab/generated',
      registryFile: 'registry/{style}/registry.json',
    }),
  )
  await writeFile(
    join(root, 'registry.json'),
    JSON.stringify({ name: 'bje', homepage: 'https://example.com', items: [{ name: 'cn' }] }),
  )
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('mirror fetch', BUILDS, () => {
  it("snapshots each style's items and theme sources, and Typeset once", async () => {
    await run(['fetch'], io())
    const colors = 'https://example.com/colors/neutral.json'
    expect(requests).toEqual([
      ...Object.keys(styleResponses('base-vega')),
      ...Object.keys(styleResponses('base-luma')),
      'https://example.com/typeset.css',
      'https://example.com/fixtures/docs.ts',
    ])
    expect(requests.filter((url) => url === colors)).toHaveLength(2)
    expect(JSON.parse(await read('upstream/base-luma/badge.json'))).toEqual(upstream)
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
      'fetched base-luma/badge',
      'fetched base-luma/index',
      'fetched base-luma/font-inter',
      'fetched base-luma/colors-neutral',
      'fetched base-luma/badge-example',
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
    delete responses['https://example.com/base-luma/badge-example.json']
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

describe('mirror build', BUILDS, () => {
  it("generates each style's components, globals and registry, and the compare style's harness", async () => {
    await run(['fetch'], io())
    logs = []
    await run(['build'], io())
    expect(await read('upstream/base-vega/index.css')).toContain('@import "tailwindcss";')
    expect(await read('registry/vega/ui/Badge/Badge.tsx')).toContain(
      'badgeVariants({ className: c })',
    )
    expect(await read('registry/vega/ui/Badge/Badge.test.tsx')).toContain('describe("Badge"')
    expect(await read('registry/vega/ui/Badge/Badge.module.scss')).toContain(':where(.badge) {')
    expect(await read('registry/vega/styles/variables.scss')).toContain(
      '--background: oklch(100% 0 0);',
    )
    expect(await read('registry/vega/styles/base.scss')).toContain('@layer base {')
    expect(await read('registry/vega/styles/fonts.css')).toContain(
      '@import "@fontsource-variable/inter";',
    )
    expect(await read('registry/vega/styles/typeset.css')).toBe(
      '/* Mirrored from https://example.com/typeset.css by scripts/mirror. Do not edit. */\n\n@layer components { .typeset { color: var(--color-foreground); } }\n',
    )
    expect(await read('registry/vega/styles/variables.scss')).toContain(
      '--color-foreground: var(--foreground);',
    )
    expect(await read('ab/generated/ours.ts')).toContain('@/registry/bje/ui/Badge/Badge')
    expect(await read('ab/generated/typeset.ts')).toContain('<h1>Docs</h1>')
    expect(await read('registry/luma/ui/Badge/Badge.module.scss')).toContain(':where(.badge) {')
    expect(JSON.parse(await read('registry/luma/tsconfig.json'))).toEqual({
      extends: '../tsconfig.json',
      compilerOptions: {
        paths: { '@/registry/bje/ui/*': ['./ui/*'], '@/registry/bje/hooks/*': ['./hooks/*'] },
      },
      include: ['.', '../../types'],
    })
    // The base keeps only the hand-written items.
    expect(JSON.parse(await read('registry.json')).items).toEqual([{ name: 'cn' }])
    const luma = JSON.parse(await read('registry/luma/registry.json'))
    expect(luma.homepage).toBe('https://example.com/luma')
    expect(luma.items[1].files[0].path).toBe('registry/luma/ui/Badge/Badge.tsx')
    const registry = JSON.parse(await read('registry/vega/registry.json'))
    expect(registry.homepage).toBe('https://example.com/vega')
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
          path: 'registry/vega/styles/variables.scss',
          type: 'registry:file',
          target: '@components/styles/variables.scss',
        },
        {
          path: 'registry/vega/styles/base.scss',
          type: 'registry:file',
          target: '@components/styles/base.scss',
        },
        {
          path: 'registry/vega/styles/fonts.css',
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
          path: 'registry/vega/styles/typeset.css',
          type: 'registry:file',
          target: '@components/styles/typeset.css',
        },
      ],
    })
    const built = (style: string) => [
      `built badge: registry/${style}/ui/Badge/Badge.tsx, registry/${style}/ui/Badge/Badge.module.scss, registry/${style}/ui/Badge/Badge.test.tsx`,
      '  badge: no CSS for group',
      `built globals: registry/${style}/styles/variables.scss, registry/${style}/styles/base.scss, registry/${style}/styles/fonts.css`,
      `built typeset: registry/${style}/styles/typeset.css`,
    ]
    expect(logs).toEqual([
      ...built('vega'),
      'example badge-example: 1 of 2 sub-examples',
      '  skipped BadgeOther: needs other',
      'built A/B harness inputs in ab/generated',
      'built registry/vega/registry.json, registry/vega/tsconfig.json',
      ...built('luma'),
      'built registry/luma/registry.json, registry/luma/tsconfig.json',
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

  it('refuses a base registry without a homepage', async () => {
    await writeFile(join(root, 'registry.json'), JSON.stringify({ name: 'bje', items: [] }))
    await run(['fetch'], io())
    await expect(run(['build'], io())).rejects.toThrow('registry.json: homepage must be a string')
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
