// `mirror fetch` snapshots the configured upstream items, their docs examples,
// the style index, font and base color, and shadcn/typeset into the repo.
// `mirror build` reads only those snapshots and writes the project CSS,
// components, global stylesheets, typeset, A/B harness inputs and
// registry.json, so a conversion change is reviewable without upstream moving
// underneath it.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  buildComponent,
  classProbe,
  markerSelectors,
  prepareComponent,
  type RegistryItem,
} from './component.ts'
import {
  colorsUrl,
  consumerClassReasons,
  type MirrorConfig,
  parseConfig,
  upstreamUrl,
} from './config.ts'
import { prepareExample } from './examples.ts'
import { globalStylesheets } from './globals.ts'
import { type HarnessExample, type HarnessInput, harnessFiles } from './harness.ts'
import { pascalCase } from './names.ts'
import { type PartTypes, partTypes, scaffolds } from './parts.ts'
import { layoutCss, projectCss } from './project-css.ts'
import { parseRegistry, upsertItems } from './registry.ts'
import { parseBaseColor, parseFontItem, parseStyleIndex, parseUpstreamItem } from './snapshots.ts'
import { compileCandidates } from './tailwind.ts'
import { fixtureHtml, type TypesetFixture } from './typeset.ts'

export type Io = {
  root: string
  fetch: (url: string) => Promise<{
    ok: boolean
    status: number
    json(): Promise<unknown>
    text(): Promise<string>
  }>
  log: (message: string) => void
  format: (path: string, content: string) => string
}

type Parse<T> = (raw: unknown, where: string) => T

// A file's text, or undefined when it does not exist. Any other failure (a
// permission error, say) propagates.
async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function parseJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${path}: ${(error as Error).message}`)
  }
}

async function readJson(path: string): Promise<unknown> {
  return parseJson(await readFile(path, 'utf8'), path)
}

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

async function writeFormatted(io: Io, path: string, content: string): Promise<void> {
  await writeText(join(io.root, path), io.format(path, content))
}

function snapshotPath(io: Io, config: MirrorConfig, name: string): string {
  return join(io.root, config.snapshotDir, config.upstream.style, `${name}.json`)
}

function missingSnapshot(name: string): never {
  throw new Error(`no snapshot for ${name}; run mirror fetch first`)
}

type Source = { name: string; url: string; parse: Parse<unknown>; optional?: boolean }

// Everything `fetch` snapshots as JSON: each component, the style's index
// item, the font, the base color, and each component's docs example (the A/B
// harness's example cases) when upstream has one.
function sources(config: MirrorConfig): Source[] {
  const font = `font-${config.theme.font}`
  return [
    ...config.components.map((name) => ({
      name,
      url: upstreamUrl(config, name),
      parse: parseUpstreamItem,
    })),
    { name: 'index', url: upstreamUrl(config, 'index'), parse: parseStyleIndex },
    { name: font, url: upstreamUrl(config, font), parse: parseFontItem },
    { name: `colors-${config.theme.baseColor}`, url: colorsUrl(config), parse: parseBaseColor },
    ...config.components.map((name) => ({
      name: `${name}-example`,
      url: upstreamUrl(config, `${name}-example`),
      parse: parseUpstreamItem,
      optional: true,
    })),
  ]
}

async function fetchAll(io: Io, config: MirrorConfig): Promise<void> {
  for (const { name, url, parse, optional } of sources(config)) {
    const path = snapshotPath(io, config, name)
    const response = await io.fetch(url)
    if (response.status === 404 && optional) {
      // Drop an older snapshot too, so build does not keep using it.
      await rm(path, { force: true })
      io.log(`no ${name} upstream`)
      continue
    }
    if (!response.ok) throw new Error(`GET ${url}: ${response.status}`)
    const item = await response.json()
    // A shape change fails here, before it is committed as a snapshot.
    parse(item, url)
    await writeText(path, `${JSON.stringify(item, null, 2)}\n`)
    io.log(`fetched ${config.upstream.style}/${name}`)
  }

  const typeset: [string, string][] = [
    ['typeset.css', config.typeset.stylesheet],
    ...config.typeset.fixtures.map((name): [string, string] => [
      `fixtures/${name}.ts`,
      config.typeset.fixturesUrl.replace('{name}', name),
    ]),
  ]
  for (const [path, url] of typeset) {
    const response = await io.fetch(url)
    if (!response.ok) throw new Error(`GET ${url}: ${response.status}`)
    await writeText(join(io.root, config.snapshotDir, 'typeset', path), await response.text())
    io.log(`fetched typeset/${path}`)
  }
}

// A snapshot, parsed, or undefined when it does not exist.
async function readOptionalSnapshot<T>(
  io: Io,
  config: MirrorConfig,
  name: string,
  parse: Parse<T>,
): Promise<T | undefined> {
  const path = snapshotPath(io, config, name)
  const text = await readOptional(path)
  return text === undefined ? undefined : parse(parseJson(text, path), path)
}

async function readSnapshot<T>(
  io: Io,
  config: MirrorConfig,
  name: string,
  parse: Parse<T>,
): Promise<T> {
  const snapshot = await readOptionalSnapshot(io, config, name, parse)
  return snapshot ?? missingSnapshot(`${config.upstream.style}/${name}`)
}

// An item's docs example source, or undefined when upstream has none (fetch
// removes the snapshot of a component upstream has no example for).
async function readExample(io: Io, config: MirrorConfig, name: string) {
  const example = `${name}-example`
  const item = await readOptionalSnapshot(io, config, example, parseUpstreamItem)
  if (item === undefined) return undefined
  return item.files[0]?.content ?? missingSnapshot(`${config.upstream.style}/${example} content`)
}

async function readTypeset(io: Io, config: MirrorConfig, path: string): Promise<string> {
  const text = await readOptional(join(io.root, config.snapshotDir, 'typeset', path))
  return text ?? missingSnapshot(`typeset/${path}`)
}

async function buildAll(io: Io, config: MirrorConfig): Promise<void> {
  const { style } = config.upstream
  const font = await readSnapshot(io, config, `font-${config.theme.font}`, parseFontItem)
  const index = await readSnapshot(io, config, 'index', parseStyleIndex)
  const colors = await readSnapshot(io, config, `colors-${config.theme.baseColor}`, parseBaseColor)
  const css = projectCss(index, colors, font)
  const cssPath = join(io.root, config.snapshotDir, style, 'index.css')
  await writeText(cssPath, css)
  const compile = (candidates: string[]) => compileCandidates(css, candidates)

  const prepared = []
  const exampleSources = new Map<string, string | undefined>()
  for (const name of config.components) {
    const upstream = await readSnapshot(io, config, name, parseUpstreamItem)
    prepared.push(await prepareComponent(upstream, config, cssPath))
    exampleSources.set(name, await readExample(io, config, name))
  }
  const types = partTypes(style, prepared)

  const items: RegistryItem[] = []
  const harness: HarnessInput[] = []
  const classes = new Set<string>()
  const probe = classProbe(prepared)
  for (const component of prepared) {
    const { name } = component.upstream
    const itemTypes = types.get(name) as Map<string, PartTypes>
    const context = {
      markers: markerSelectors(prepared, component),
      classProbe: probe,
      types: itemTypes,
      scaffolds: scaffolds(name, exampleSources.get(name), itemTypes, component.transformed),
    }
    const built = await buildComponent(component, config, compile, context)
    // The component's folder is all generated: clear it so a file the
    // pipeline stopped writing (a module for a component that lost its
    // classes) does not linger.
    const dir = join(io.root, config.outputDir, pascalCase(name))
    await rm(dir, { recursive: true, force: true })
    for (const file of built.files) await writeFormatted(io, file.path, file.content)
    for (const c of built.classes) classes.add(c)
    items.push(built.item)
    harness.push({
      name,
      upstreamSource: built.upstreamSource,
      transformed: built.transformed,
      types: itemTypes,
      scaffolds: context.scaffolds,
    })
    io.log(`built ${name}: ${built.files.map((file) => file.path).join(', ')}`)
    for (const [slot, unresolved] of Object.entries(built.unresolved)) {
      io.log(`  ${slot}: no CSS for ${unresolved.join(' ')}`)
    }
  }

  const header = `// Generated by scripts/mirror from shadcn ${style} (${config.theme.baseColor}, ${config.theme.font}). Do not edit.`
  // Typeset is imported after Tailwind upstream, which makes Tailwind emit the
  // theme variables it reads (--color-foreground, --font-heading, ...).
  const typesetCss = await readTypeset(io, config, 'typeset.css')
  const sheets = globalStylesheets(
    await compileCandidates(`${css}\n${typesetCss}`, [...classes].sort()),
    header,
  )
  const files = [
    ...Object.entries(sheets).map(([sheet, content]) => ({
      path: `${config.globalsDir}/${sheet}.scss`,
      content,
    })),
    {
      path: `${config.globalsDir}/fonts.css`,
      content: `${header.replace(/^\/\/ (.*)$/, '/* $1 */')}\n\n@import ${JSON.stringify(font.font.dependency)};\n`,
    },
  ]
  const typesetFile = {
    path: `${config.globalsDir}/typeset.css`,
    content: `/* Mirrored from ${config.typeset.stylesheet} by scripts/mirror. Do not edit. */\n\n${typesetCss}`,
  }
  for (const file of [...files, typesetFile]) await writeFormatted(io, file.path, file.content)
  const target = (path: string) => `@components/styles/${path.split('/').at(-1)}`
  items.push(
    {
      name: 'globals',
      type: 'registry:file',
      title: 'Globals',
      dependencies: [font.font.dependency],
      // Needed to compile the .scss stylesheets.
      devDependencies: ['sass'],
      registryDependencies: [],
      files: files.map(({ path }) => ({ path, type: 'registry:file', target: target(path) })),
    },
    {
      name: 'typeset',
      type: 'registry:file',
      title: 'Typeset',
      dependencies: [],
      devDependencies: [],
      registryDependencies: [`@${config.namespace}/globals`],
      files: [{ path: typesetFile.path, type: 'registry:file', target: target(typesetFile.path) }],
    },
  )
  io.log(`built globals: ${files.map((file) => file.path).join(', ')}`)
  io.log(`built typeset: ${typesetFile.path}`)

  const mirrored = new Set(config.components)
  const dropped = new Set(consumerClassReasons(config).keys())
  const examples: HarnessExample[] = []
  for (const [name, source] of exampleSources) {
    if (source === undefined) continue
    const example = `${name}-example`
    const prepared = prepareExample(source, style, config.namespace, mirrored, dropped)
    examples.push({ name: example, prepared })
    io.log(
      `example ${example}: ${prepared.kept.length} of ${prepared.kept.length + prepared.skipped.length} sub-examples`,
    )
    for (const { name: sub, reasons } of prepared.skipped) {
      io.log(`  skipped ${sub}: ${reasons.join('; ')}`)
    }
  }

  const typeset: TypesetFixture[] = []
  for (const name of config.typeset.fixtures) {
    typeset.push(...fixtureHtml(name, await readTypeset(io, config, `fixtures/${name}.ts`)))
  }

  const harnessHeader = `// Generated by scripts/mirror from shadcn ${style}. Do not edit.`
  const layout = layoutCss(index, colors, font, './examples/ours')
  const inputs = { components: harness, examples, layoutCss: layout, typeset }
  for (const file of harnessFiles(config, inputs, harnessHeader)) {
    await writeFormatted(io, file.path, file.content)
  }
  io.log(`built A/B harness inputs in ${config.harnessDir}`)

  const registryPath = join(io.root, 'registry.json')
  const generatedDirs = [config.outputDir, config.globalsDir].map((dir) => `${dir}/`)
  const registry = upsertItems(parseRegistry(await readJson(registryPath), registryPath), items, {
    // Items the mirror generated before and config no longer produces.
    owned: (item) =>
      (item.files ?? []).some(({ path }) => generatedDirs.some((dir) => path.startsWith(dir))),
  })
  await writeFormatted(io, 'registry.json', `${JSON.stringify(registry, null, 2)}\n`)
}

export async function run(args: string[], io: Io): Promise<void> {
  const [command, ...rest] = args
  if ((command !== 'fetch' && command !== 'build') || rest.length > 0) {
    throw new Error('usage: mirror <fetch|build>')
  }
  const config = parseConfig(await readJson(join(io.root, 'mirror.config.json')))
  if (command === 'fetch') await fetchAll(io, config)
  else await buildAll(io, config)
}
