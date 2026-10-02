// `pnpm install-check`: installs every item of one built style, as a consumer
// would, into a scratch Vite + React + TypeScript + Sass project, then
// type-checks it, runs the shipped tests and builds it. The items are served
// over HTTP: the shadcn CLI cannot fetch a file:// registry URL.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { Shape } from '../mirror/parse.ts'

export type ItemFile = { path: string; type: string; target?: string }

export type Item = {
  name: string
  dependencies: string[]
  devDependencies: string[]
  registryDependencies: string[]
  files: (ItemFile & { content: string })[]
}

// The built catalog: the namespace and every item name, in catalog order.
export function parseCatalog(raw: unknown): { namespace: string; names: string[] } {
  const shape: Shape = new Shape('registry.json')
  const catalog = shape.record(raw, 'catalog')
  if (!Array.isArray(catalog.items)) shape.fail('items must be an array')
  return {
    namespace: shape.string(catalog.name, 'name'),
    names: catalog.items.map((item, i) =>
      shape.string(shape.record(item, `items[${i}]`).name, `items[${i}].name`),
    ),
  }
}

export function parseItem(raw: unknown, where: string): Item {
  const shape: Shape = new Shape(where)
  const item = shape.record(raw, 'item')
  const list = (key: string) => (item[key] === undefined ? [] : shape.strings(item[key], key))
  if (!Array.isArray(item.files)) shape.fail('files must be an array')
  return {
    name: shape.string(item.name, 'name'),
    dependencies: list('dependencies'),
    devDependencies: list('devDependencies'),
    registryDependencies: list('registryDependencies'),
    files: item.files.map((value, i) => {
      const file = shape.record(value, `files[${i}]`)
      const target =
        file.target == null ? undefined : shape.string(file.target, `files[${i}].target`)
      return {
        path: shape.string(file.path, `files[${i}].path`),
        type: shape.string(file.type, `files[${i}].type`),
        content: shape.string(file.content, `files[${i}].content`),
        ...(target === undefined ? {} : { target }),
      }
    }),
  }
}

// The scratch project's aliases, all under src/.
const ALIASES = {
  components: '@/components',
  ui: '@/components/ui',
  hooks: '@/hooks',
  lib: '@/lib',
  utils: '@/lib/utils',
}
const onDisk = (alias: string) => alias.replace(/^@\//, 'src/')

// Where `shadcn add` should write a file: its target under the named alias,
// or, untargeted, its path below the directory its type names.
export function expectedPath(file: ItemFile): string {
  if (file.target !== undefined) {
    const match = /^@(components|ui|hooks|lib)\/(.+)$/.exec(file.target)
    if (!match) throw new Error(`${file.path}: unsupported target ${file.target}`)
    return `${onDisk(ALIASES[match[1] as 'components'])}/${match[2]}`
  }
  const dirs: Record<string, string> = {
    'registry:ui': 'ui',
    'registry:hook': 'hooks',
    'registry:lib': 'lib',
  }
  const dir = dirs[file.type]
  const below = dir === undefined ? undefined : file.path.split(`/${dir}/`)[1]
  if (dir === undefined || below === undefined) {
    throw new Error(`${file.path}: no target, and ${file.type} has no alias directory`)
  }
  return `${onDisk(ALIASES[dir as 'ui'])}/${below}`
}

// `recharts@3.8.0` is recharts at 3.8.0; `@scope/name` has no version.
export function splitSpec(spec: string): { name: string; version?: string } {
  const at = spec.lastIndexOf('@')
  return at > 0 ? { name: spec.slice(0, at), version: spec.slice(at + 1) } : { name: spec }
}

// The package a bare import specifier resolves to; undefined for a relative,
// aliased or node: import.
export function packageOf(specifier: string): string | undefined {
  if (/^(\.|\/|@\/|node:)/.test(specifier)) return undefined
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|@import\s+)['"]([^'"]+)['"]/g

function specifiers(source: string): string[] {
  return [...new Set([...source.matchAll(SPECIFIER)].map((match) => match[1] as string))]
}

export function importedPackages(source: string): string[] {
  const found = specifiers(source).map(packageOf)
  return [...new Set(found.filter((name) => name !== undefined))]
}

// An import of another item's file, in the registry's own layout:
// @/registry/bje/ui/Button/Button names ui/Button/Button.
const REGISTRY_IMPORT = /^@\/registry\/[^/]+\/(.+)$/

// Packages every item may import without declaring them: the scaffold's.
const PROVIDED = new Set(['react', 'react-dom'])

// Each item's files import only packages and items it, or an item it depends
// on through registryDependencies, declares: installing it alone would miss the
// others.
export function undeclaredImports(items: Item[], namespace: string): string[] {
  const byName = new Map(items.map((item) => [item.name, item]))
  const prefix = `@${namespace}/`
  // The CLI resolves a bare name against its default registry, not this one.
  const local = (dependency: string) =>
    dependency.startsWith(prefix) ? byName.get(dependency.slice(prefix.length)) : undefined
  const reach = (item: Item, seen: Map<string, Item>): Map<string, Item> => {
    seen.set(item.name, item)
    for (const dependency of item.registryDependencies) {
      const other = local(dependency)
      if (other !== undefined && !seen.has(other.name)) reach(other, seen)
    }
    return seen
  }
  const owner = (path: string) =>
    items.find((item) =>
      item.files.some((file) =>
        [file.path, file.path.replace(/\.[^./]+$/, '')].some((shipped) =>
          shipped.endsWith(`/${path}`),
        ),
      ),
    )
  return items.flatMap((item) => {
    const reached = reach(item, new Map())
    const names = new Set([
      ...PROVIDED,
      ...[...reached.values()].flatMap((other) =>
        [...other.dependencies, ...other.devDependencies].map((spec) => splitSpec(spec).name),
      ),
    ])
    const problems = (path: string, specifier: string): string[] => {
      const shipped = REGISTRY_IMPORT.exec(specifier)?.[1]
      if (shipped !== undefined) {
        const other = owner(shipped)
        if (other === undefined) return [`${path} imports ${specifier}, which no item ships`]
        return reached.has(other.name)
          ? []
          : [
              `${path} imports ${specifier} from ${other.name}, which no registry dependency reaches`,
            ]
      }
      const pkg = packageOf(specifier)
      return pkg === undefined || names.has(pkg)
        ? []
        : [`${path} imports ${pkg}, which no dependency declares`]
    }
    return [
      ...item.registryDependencies
        .filter((dependency) => local(dependency) === undefined)
        .map(
          (dependency) => `${item.name}: registry dependency ${dependency} is not in the registry`,
        ),
      ...item.files.flatMap((file) =>
        [
          ...new Set(
            specifiers(file.content).flatMap((specifier) => problems(file.path, specifier)),
          ),
        ].map((problem) => `${item.name}: ${problem}`),
      ),
    ]
  })
}

// After `shadcn add`: every file where its alias puts it, every package in the
// project's package.json, and an exact version installed at that version.
export function installProblems(items: Item[], project: string): string[] {
  const problems: string[] = []
  const pkg = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'))
  const listed = { ...pkg.dependencies, ...pkg.devDependencies }
  for (const item of items) {
    for (const file of item.files) {
      const path = expectedPath(file)
      if (!existsSync(join(project, path))) {
        problems.push(`${item.name}: ${file.path} was not written to ${path}`)
      }
    }
    for (const spec of [...item.dependencies, ...item.devDependencies]) {
      const { name, version } = splitSpec(spec)
      if (!(name in listed)) {
        problems.push(`${item.name}: ${name} is not in the project's package.json`)
      } else if (version !== undefined && /^\d+\.\d+\.\d+$/.test(version)) {
        const manifest = join(project, 'node_modules', name, 'package.json')
        const installed = JSON.parse(readFileSync(manifest, 'utf8')).version
        if (installed !== version) {
          problems.push(`${item.name}: ${name}@${version} installed as ${installed}`)
        }
      }
    }
  }
  return problems
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
  )
}

// An import the CLI left pointing into the registry's own layout.
export function unrewrittenImports(project: string): string[] {
  return filesUnder(join(project, 'src'))
    .filter((path) => readFileSync(path, 'utf8').includes('@/registry/'))
    .map((path) => `${relative(project, path)} still imports from @/registry/`)
}

export type Scaffold = {
  registryUrl: string
  // The shadcn style name the project is initialised with.
  style: string
  namespace: string
}

export const SCAFFOLD_PACKAGES = {
  dependencies: ['react', 'react-dom'],
  devDependencies: [
    'typescript',
    'vite',
    '@vitejs/plugin-react',
    '@types/react',
    '@types/react-dom',
  ],
}

// The project `shadcn add` installs into. Testing packages come only from the
// items' devDependencies, so a missing one fails the run.
export function scaffoldFiles({ registryUrl, style, namespace }: Scaffold): Record<string, string> {
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`
  return {
    'package.json': json({ name: 'install-check', private: true, type: 'module' }),
    // The public registry, whatever the machine's npm configuration says.
    '.npmrc': 'registry=https://registry.npmjs.org/\n',
    'components.json': json({
      $schema: 'https://ui.shadcn.com/schema.json',
      style,
      rsc: false,
      tsx: true,
      tailwind: { config: '', css: '', baseColor: 'neutral', cssVariables: true },
      iconLibrary: 'lucide',
      aliases: ALIASES,
      registries: { [`@${namespace}`]: `${registryUrl}/{name}.json` },
    }),
    'tsconfig.json': json({
      compilerOptions: {
        target: 'es2022',
        lib: ['es2022', 'dom', 'dom.iterable'],
        jsx: 'react-jsx',
        module: 'esnext',
        moduleResolution: 'bundler',
        strict: true,
        noEmit: true,
        isolatedModules: true,
        skipLibCheck: true,
        types: ['vite/client'],
        paths: { '@/*': ['./src/*'] },
      },
      include: ['src'],
    }),
    'vite.config.ts': [
      "import react from '@vitejs/plugin-react'",
      "import { defineConfig } from 'vite'",
      '',
      'export default defineConfig({',
      '  plugins: [react()],',
      "  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },",
      "  test: { environment: 'jsdom' },",
      '})',
      '',
    ].join('\n'),
    'index.html':
      '<!doctype html>\n<div id="root"></div>\n<script type="module" src="/src/main.ts"></script>\n',
    // Every installed module and stylesheet, so the build compiles each one.
    'src/main.ts': [
      'import.meta.glob(',
      "  ['./**/*.{ts,tsx,css,scss}', '!./**/*.test.{ts,tsx}', '!./main.ts'],",
      '  { eager: true },',
      ')',
      '',
    ].join('\n'),
  }
}

export type Server = { url: string; close(): Promise<void> }

// Serves the files in dir, and nothing outside it.
export async function serve(dir: string): Promise<Server> {
  const root = resolve(dir)
  const server = createServer((request, response) => {
    const { pathname } = new URL(String(request.url), 'http://localhost')
    const path = resolve(root, `.${decodeURIComponent(pathname)}`)
    if (path.startsWith(`${root}${sep}`) && existsSync(path) && statSync(path).isFile()) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(readFileSync(path))
    } else {
      response.writeHead(404)
      response.end()
    }
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((done) => server.close(() => done())),
  }
}

export type Io = {
  // The repository root, where the pinned shadcn CLI is installed.
  root: string
  // The built style directory, holding registry.json and one JSON per item.
  registryDir: string
  // An empty directory for the scratch project.
  project: string
  style: string
  versions: Record<string, string>
  // Runs a command to completion, rejecting when it exits non-zero. Async, so
  // the registry server keeps answering while the shadcn CLI runs.
  exec: (command: string, args: string[], cwd: string) => Promise<void>
  log: (message: string) => void
}

function fail(problems: string[]): void {
  if (problems.length > 0) throw new Error(problems.join('\n'))
}

export async function run(io: Io): Promise<void> {
  const read = (name: string) => JSON.parse(readFileSync(join(io.registryDir, name), 'utf8'))
  const { namespace, names } = parseCatalog(read('registry.json'))
  const items = names.map((name) => parseItem(read(`${name}.json`), `${name}.json`))
  fail(undeclaredImports(items, namespace))
  const pinned = (packages: string[]) =>
    packages.map((name) => {
      const version = io.versions[name]
      if (version === undefined) throw new Error(`no version for scaffold package ${name}`)
      return `${name}@${version}`
    })
  const dependencies = pinned(SCAFFOLD_PACKAGES.dependencies)
  const devDependencies = pinned(SCAFFOLD_PACKAGES.devDependencies)

  io.log(
    `Installing ${items.length} items of @${namespace} from ${io.registryDir} into ${io.project}`,
  )
  const server = await serve(io.registryDir)
  try {
    const files = scaffoldFiles({ registryUrl: server.url, style: io.style, namespace })
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(io.project, path)), { recursive: true })
      writeFileSync(join(io.project, path), content)
    }
    await io.exec('pnpm', ['add', ...dependencies], io.project)
    await io.exec('pnpm', ['add', '-D', ...devDependencies], io.project)
    const specs = names.map((name) => `@${namespace}/${name}`)
    await io.exec(
      'pnpm',
      ['exec', 'shadcn', 'add', ...specs, '--yes', '--cwd', io.project],
      io.root,
    )
  } finally {
    await server.close()
  }

  fail([...installProblems(items, io.project), ...unrewrittenImports(io.project)])
  await io.exec('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json'], io.project)
  await io.exec('pnpm', ['exec', 'vitest', 'run'], io.project)
  await io.exec('pnpm', ['exec', 'vite', 'build'], io.project)
  io.log(`Installed, type-checked, tested and built ${items.length} items`)
}
