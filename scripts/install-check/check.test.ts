import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  expectedPath,
  type Io,
  type Item,
  importedPackages,
  installProblems,
  packageOf,
  parseCatalog,
  parseItem,
  run,
  SCAFFOLD_PACKAGES,
  scaffoldFiles,
  serve,
  splitSpec,
  undeclaredImports,
  unrewrittenImports,
} from './check.ts'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'install-check-test-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function write(path: string, content: string) {
  mkdirSync(dirname(join(dir, path)), { recursive: true })
  writeFileSync(join(dir, path), content)
}

const item = (overrides: Partial<Item> & { name: string }): Item => ({
  dependencies: [],
  devDependencies: [],
  registryDependencies: [],
  files: [],
  ...overrides,
})

describe('parseCatalog', () => {
  it('reads the namespace and every item name, in order', () => {
    expect(parseCatalog({ name: 'bje', items: [{ name: 'cn' }, { name: 'button' }] })).toEqual({
      namespace: 'bje',
      names: ['cn', 'button'],
    })
  })

  it('refuses a catalog without items', () => {
    expect(() => parseCatalog({ name: 'bje' })).toThrow('registry.json: items must be an array')
  })

  it('refuses a catalog without a name, or an item without one', () => {
    expect(() => parseCatalog({ items: [] })).toThrow('registry.json')
    expect(() => parseCatalog({ name: 'bje', items: [{}] })).toThrow('items[0].name')
  })
})

describe('parseItem', () => {
  it('reads files, targets and every dependency list', () => {
    const raw = {
      name: 'globals',
      dependencies: ['a'],
      devDependencies: ['sass'],
      registryDependencies: ['@bje/cn'],
      files: [
        { path: 'x.scss', type: 'registry:file', target: '@components/x.scss', content: 'x' },
        { path: 'y.ts', type: 'registry:lib', target: null, content: 'y' },
      ],
    }
    expect(parseItem(raw, 'globals.json')).toEqual({
      name: 'globals',
      dependencies: ['a'],
      devDependencies: ['sass'],
      registryDependencies: ['@bje/cn'],
      files: [
        { path: 'x.scss', type: 'registry:file', target: '@components/x.scss', content: 'x' },
        { path: 'y.ts', type: 'registry:lib', content: 'y' },
      ],
    })
  })

  it('reads an absent dependency list as empty', () => {
    expect(parseItem({ name: 'cn', files: [] }, 'cn.json')).toEqual(item({ name: 'cn' }))
  })

  it('refuses an item without files', () => {
    expect(() => parseItem({ name: 'cn' }, 'cn.json')).toThrow('cn.json: files must be an array')
  })

  it('refuses a file without content, and a null dependency list', () => {
    const files = [{ path: 'a.ts', type: 'registry:lib' }]
    expect(() => parseItem({ name: 'cn', files }, 'cn.json')).toThrow('files[0].content')
    expect(() => parseItem({ name: 'cn', dependencies: null, files: [] }, 'cn.json')).toThrow(
      'dependencies',
    )
  })
})

describe('expectedPath', () => {
  it('puts a targeted file under the alias its target names', () => {
    expect(expectedPath({ path: 'a', type: 'registry:file', target: '@components/s/a.css' })).toBe(
      'src/components/s/a.css',
    )
    expect(expectedPath({ path: 'a', type: 'registry:file', target: '@hooks/a.ts' })).toBe(
      'src/hooks/a.ts',
    )
    expect(expectedPath({ path: 'a', type: 'registry:file', target: '@ui/A/a.tsx' })).toBe(
      'src/components/ui/A/a.tsx',
    )
    expect(expectedPath({ path: 'a', type: 'registry:file', target: '@lib/a.ts' })).toBe(
      'src/lib/a.ts',
    )
  })

  it('refuses a target outside the aliases', () => {
    expect(() => expectedPath({ path: 'a', type: 'registry:file', target: 'src/a.ts' })).toThrow(
      'a: unsupported target src/a.ts',
    )
  })

  it("puts an untargeted file below its type's alias directory", () => {
    const at = (path: string, type: string) => expectedPath({ path, type })
    expect(at('registry/vega/ui/Button/Button.tsx', 'registry:ui')).toBe(
      'src/components/ui/Button/Button.tsx',
    )
    expect(at('registry/vega/hooks/use-mobile.ts', 'registry:hook')).toBe('src/hooks/use-mobile.ts')
    expect(at('registry/lib/cn.ts', 'registry:lib')).toBe('src/lib/cn.ts')
  })

  it('refuses an untargeted file it cannot place', () => {
    expect(() => expectedPath({ path: 'a.css', type: 'registry:file' })).toThrow(
      'a.css: no target, and registry:file has no alias directory',
    )
    expect(() => expectedPath({ path: 'registry/a.tsx', type: 'registry:ui' })).toThrow(
      'registry/a.tsx: no target, and registry:ui has no alias directory',
    )
  })
})

describe('splitSpec', () => {
  it('splits a version from a package name, scoped or not', () => {
    expect(splitSpec('recharts@3.8.0')).toEqual({ name: 'recharts', version: '3.8.0' })
    expect(splitSpec('@base-ui/react@1.8.0')).toEqual({ name: '@base-ui/react', version: '1.8.0' })
    expect(splitSpec('@base-ui/react')).toEqual({ name: '@base-ui/react' })
  })
})

describe('packageOf', () => {
  it('names the package of a bare specifier', () => {
    expect(packageOf('@base-ui/react/merge-props')).toBe('@base-ui/react')
    expect(packageOf('react-dom/client')).toBe('react-dom')
  })

  it('ignores relative, aliased and node: specifiers', () => {
    for (const specifier of ['./Button', '/abs', '@/components/ui/Button', 'node:fs']) {
      expect(packageOf(specifier)).toBeUndefined()
    }
  })
})

describe('importedPackages', () => {
  it('finds static, side-effect, dynamic and CSS imports, once each', () => {
    const source = [
      "import { a } from 'clsx'",
      'import {',
      '  b,',
      "} from '@base-ui/react/menu'",
      "import 'side-effect'",
      "const lazy = import('dynamic')",
      '@import "@fontsource-variable/inter";',
      "export { c } from 'clsx'",
      "import styles from './Button.module.scss'",
    ].join('\n')
    expect(importedPackages(source)).toEqual([
      'clsx',
      '@base-ui/react',
      'side-effect',
      'dynamic',
      '@fontsource-variable/inter',
    ])
  })
})

describe('undeclaredImports', () => {
  const file = (content: string, path = 'f.tsx') => ({ path, type: 'registry:ui', content })

  it('accepts an import declared by the item, the items it reaches, or the scaffold', () => {
    const items = [
      item({
        name: 'cn',
        dependencies: ['clsx'],
        files: [file("import 'clsx'", 'registry/lib/cn.ts')],
      }),
      item({
        name: 'button',
        registryDependencies: ['@bje/cn'],
        devDependencies: ['vitest'],
        files: [file('', 'registry/vega/ui/Button/Button.tsx')],
      }),
      // cn only through button.
      item({
        name: 'chart',
        dependencies: ['recharts@3.8.0'],
        registryDependencies: ['@bje/button'],
        files: [
          file(
            [
              "import 'clsx'",
              "import 'recharts'",
              "import 'vitest'",
              "import 'react'",
              "import 'react-dom'",
              "import { Button } from '@/registry/bje/ui/Button/Button'",
              "import { cn } from '@/registry/bje/lib/cn'",
              "import '@/registry/bje/ui/Chart/Chart.module.scss'",
            ].join('\n'),
            'registry/vega/ui/Chart/Chart.tsx',
          ),
          file('', 'registry/vega/ui/Chart/Chart.module.scss'),
        ],
      }),
    ]
    expect(undeclaredImports(items, 'bje')).toEqual([])
  })

  it('reports an import or item nothing it reaches declares, once each', () => {
    const items = [
      item({
        name: 'a',
        registryDependencies: ['@bje/b', '@bje/gone', 'c'],
        files: [
          file(
            [
              "import 'x/one'",
              "import 'x/two'",
              "import 'y'",
              "import { C } from '@/registry/bje/ui/C/C'",
              "import { D } from '@/registry/bje/ui/D/D'",
            ].join('\n'),
          ),
        ],
      }),
      // A cycle back to a is followed once.
      item({ name: 'b', registryDependencies: ['@bje/a'] }),
      // Not reached from a: a bare name is the CLI's default registry's.
      item({ name: 'c', dependencies: ['y'], files: [file('', 'registry/vega/ui/C/C.tsx')] }),
    ]
    expect(undeclaredImports(items, 'bje')).toEqual([
      'a: registry dependency @bje/gone is not in the registry',
      'a: registry dependency c is not in the registry',
      'a: f.tsx imports x, which no dependency declares',
      'a: f.tsx imports y, which no dependency declares',
      'a: f.tsx imports @/registry/bje/ui/C/C from c, which no registry dependency reaches',
      'a: f.tsx imports @/registry/bje/ui/D/D, which no item ships',
    ])
  })
})

describe('installProblems', () => {
  const chart = item({
    name: 'chart',
    dependencies: ['recharts@3.8.0', 'react-day-picker@latest'],
    devDependencies: ['sass'],
    files: [{ path: 'registry/vega/ui/Chart/Chart.tsx', type: 'registry:ui', content: '' }],
  })

  function project(pkg: unknown, recharts: string) {
    write('package.json', JSON.stringify(pkg))
    write('node_modules/recharts/package.json', JSON.stringify({ version: recharts }))
  }

  it('accepts every file in place and every package listed at its version', () => {
    project(
      {
        dependencies: { recharts: '3.8.0', 'react-day-picker': '^10', ranged: '^1.2.3' },
        devDependencies: { sass: '1' },
      },
      '3.8.0',
    )
    write('src/components/ui/Chart/Chart.tsx', '')
    // A range is not a pin: ranged has no installed manifest to read.
    expect(
      installProblems([{ ...chart, dependencies: [...chart.dependencies, 'ranged@^1.2.3'] }], dir),
    ).toEqual([])
  })

  it('reports a file not written, a package not listed, and a version not installed', () => {
    project({ dependencies: { recharts: '3.8.0', 'react-day-picker': '^10' } }, '3.9.0')
    expect(installProblems([chart], dir)).toEqual([
      'chart: registry/vega/ui/Chart/Chart.tsx was not written to src/components/ui/Chart/Chart.tsx',
      'chart: recharts@3.8.0 installed as 3.9.0',
      "chart: sass is not in the project's package.json",
    ])
  })
})

describe('unrewrittenImports', () => {
  it('reports every file under src that still imports from the registry layout', () => {
    write('src/components/ui/A/A.tsx', "import { B } from '@/registry/bje/ui/B/B'")
    write('src/hooks/ok.ts', "import { B } from '@/components/ui/B/B'")
    expect(unrewrittenImports(dir)).toEqual([
      'src/components/ui/A/A.tsx still imports from @/registry/',
    ])
  })
})

describe('scaffoldFiles', () => {
  it('points the namespace at the served registry, with every alias under src', () => {
    const files = scaffoldFiles({ registryUrl: 'http://h:1', style: 'base-vega', namespace: 'bje' })
    const components = JSON.parse(files['components.json'] as string)
    expect(components.style).toBe('base-vega')
    expect(components.registries).toEqual({ '@bje': 'http://h:1/{name}.json' })
    expect(components.aliases).toEqual({
      components: '@/components',
      ui: '@/components/ui',
      hooks: '@/hooks',
      lib: '@/lib',
      utils: '@/lib/utils',
    })
    const { compilerOptions } = JSON.parse(files['tsconfig.json'] as string)
    expect(compilerOptions.paths).toEqual({ '@/*': ['./src/*'] })
    expect(compilerOptions.strict).toBe(true)
    expect(files['.npmrc']).toBe('registry=https://registry.npmjs.org/\n')
    // The build compiles every module and stylesheet, and no test.
    expect(files['src/main.ts']).toContain(
      "['./**/*.{ts,tsx,css,scss}', '!./**/*.test.{ts,tsx}', '!./main.ts']",
    )
    expect(Object.keys(files).sort()).toEqual([
      '.npmrc',
      'components.json',
      'index.html',
      'package.json',
      'src/main.ts',
      'tsconfig.json',
      'vite.config.ts',
    ])
  })
})

// A raw request, so a percent-encoded path reaches the server as sent.
function get(url: string, path: string): Promise<{ status: number; body: string }> {
  return new Promise((done, failed) => {
    request(`${url}${path}`, (response) => {
      let body = ''
      response.on('data', (chunk) => {
        body += chunk
      })
      response.on('end', () => done({ status: response.statusCode as number, body }))
    })
      .on('error', failed)
      .end()
  })
}

describe('serve', () => {
  it('serves the files in its directory and nothing else', async () => {
    write('r/button.json', '{"name":"button"}')
    write('r/sub/x.json', '{}')
    write('secret.json', '{}')
    write('rx.json', '{}')
    const server = await serve(join(dir, 'r'))
    try {
      expect(await get(server.url, '/button.json')).toEqual({
        status: 200,
        body: '{"name":"button"}',
      })
      expect((await get(server.url, '/missing.json')).status).toBe(404)
      expect((await get(server.url, '/sub')).status).toBe(404)
      expect((await get(server.url, '/')).status).toBe(404)
      expect((await get(server.url, '/%2E%2E%2Fsecret.json')).status).toBe(404)
      // A sibling whose name starts with the directory's.
      expect((await get(server.url, '/%2E%2E%2Frx.json')).status).toBe(404)
    } finally {
      await server.close()
    }
  })
})

describe('run', () => {
  const versions = Object.fromEntries(
    [...SCAFFOLD_PACKAGES.dependencies, ...SCAFFOLD_PACKAGES.devDependencies].map((name) => [
      name,
      '1.0.0',
    ]),
  )
  const cn = {
    name: 'cn',
    type: 'registry:lib',
    dependencies: ['clsx'],
    files: [{ path: 'registry/lib/cn.ts', type: 'registry:lib', content: "import 'clsx'" }],
  }
  const button = {
    name: 'button',
    type: 'registry:ui',
    registryDependencies: ['@bje/cn'],
    files: [
      {
        path: 'registry/vega/ui/Button/Button.tsx',
        type: 'registry:ui',
        content: "import { cn } from '@/registry/bje/lib/cn'",
      },
    ],
  }

  let calls: string[]
  let logs: string[]
  let served: string | undefined

  beforeEach(() => {
    calls = []
    logs = []
    served = undefined
    write(
      'r/registry.json',
      JSON.stringify({ name: 'bje', items: [{ name: 'cn' }, { name: 'button' }] }),
    )
    write('r/cn.json', JSON.stringify(cn))
    write('r/button.json', JSON.stringify(button))
    mkdirSync(join(dir, 'p'))
  })

  // Stands in for pnpm and the shadcn CLI: `shadcn add` fetches each item
  // through components.json, as the CLI does, and writes it where its alias
  // puts it, rewritten unless told otherwise.
  function io(
    options: { rewrite?: boolean; failing?: string; skip?: string; packages?: object } = {},
  ): Io {
    const project = join(dir, 'p')
    return {
      root: dir,
      registryDir: join(dir, 'r'),
      project,
      style: 'base-vega',
      versions,
      log: (message) => logs.push(message),
      exec: async (command, args, cwd) => {
        const call = `${command} ${args.join(' ')}`
        calls.push(`${call} @ ${cwd === project ? 'project' : 'root'}`)
        if (args[1] === 'shadcn') {
          const { registries } = JSON.parse(readFileSync(join(project, 'components.json'), 'utf8'))
          served = registries['@bje'].replace('{name}', 'cn')
        }
        if (options.failing !== undefined && call.includes(options.failing)) {
          throw new Error(`${call} exited 1`)
        }
        if (args[1] !== 'shadcn') return
        const config = JSON.parse(readFileSync(join(project, 'components.json'), 'utf8'))
        for (const spec of args.slice(3, -3)) {
          const name = spec.replace('@bje/', '')
          const response = await fetch(config.registries['@bje'].replace('{name}', name))
          const fetched = parseItem(await response.json(), name)
          for (const file of fetched.files) {
            if (file.path === options.skip) continue
            const content =
              options.rewrite === false ? file.content : file.content.replace('@/registry/bje', '@')
            mkdirSync(dirname(join(project, expectedPath(file))), { recursive: true })
            writeFileSync(join(project, expectedPath(file)), content)
          }
        }
        writeFileSync(
          join(project, 'package.json'),
          JSON.stringify(options.packages ?? { dependencies: { clsx: '2' } }),
        )
      },
    }
  }

  it('scaffolds, installs every catalog item, then type-checks, tests and builds', async () => {
    await run(io())
    expect(calls).toEqual([
      'pnpm add react@1.0.0 react-dom@1.0.0 @ project',
      'pnpm add -D typescript@1.0.0 vite@1.0.0 @vitejs/plugin-react@1.0.0 @types/react@1.0.0 @types/react-dom@1.0.0 @ project',
      `pnpm exec shadcn add @bje/cn @bje/button --yes --cwd ${join(dir, 'p')} @ root`,
      'pnpm exec tsc -p tsconfig.json @ project',
      'pnpm exec vitest run @ project',
      'pnpm exec vite build @ project',
    ])
    expect(readFileSync(join(dir, 'p/src/main.ts'), 'utf8')).toContain('import.meta.glob(')
    expect(logs).toEqual([
      `Installing 2 items of @bje from ${join(dir, 'r')} into ${join(dir, 'p')}`,
      'Installed, type-checked, tested and built 2 items',
    ])
  })

  it('fails before installing when an item imports a package nothing declares', async () => {
    write('r/cn.json', JSON.stringify({ ...cn, dependencies: [] }))
    await expect(run(io())).rejects.toThrow(
      'cn: registry/lib/cn.ts imports clsx, which no dependency declares',
    )
    expect(calls).toEqual([])
  })

  it('fails before installing when a scaffold package has no version', async () => {
    await expect(run({ ...io(), versions: {} })).rejects.toThrow(
      'no version for scaffold package react',
    )
    expect(calls).toEqual([])
  })

  it('fails on an import the CLI left unrewritten, before type-checking', async () => {
    await expect(run(io({ rewrite: false }))).rejects.toThrow(
      'src/components/ui/Button/Button.tsx still imports from @/registry/',
    )
    expect(calls).toHaveLength(3)
  })

  it('fails on a file not written or a package not listed, before type-checking', async () => {
    await expect(run(io({ skip: 'registry/lib/cn.ts', packages: {} }))).rejects.toThrow(
      [
        'cn: registry/lib/cn.ts was not written to src/lib/cn.ts',
        "cn: clsx is not in the project's package.json",
      ].join('\n'),
    )
    expect(calls).toHaveLength(3)
  })

  it.each([
    ['add react', 1],
    ['add -D', 2],
    ['shadcn add', 3],
    ['tsc', 4],
    ['vitest', 5],
    ['vite build', 6],
  ])('fails, and stops, when %s fails', async (failing, count) => {
    await expect(run(io({ failing }))).rejects.toThrow(failing)
    expect(calls).toHaveLength(count)
    // Let any command left running without an await reach the fake.
    await new Promise((done) => setTimeout(done, 10))
    expect(calls).toHaveLength(count)
  })

  it('stops serving the registry when the install fails', async () => {
    await expect(run(io({ failing: 'shadcn add' }))).rejects.toThrow('shadcn add')
    await expect(fetch(served as string)).rejects.toThrow()
  })
})
