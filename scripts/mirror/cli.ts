// `mirror fetch` snapshots each configured upstream item into the repo;
// `mirror build` converts the snapshots and updates registry.json. Build reads
// only snapshots, so a conversion change is reviewable without upstream
// moving underneath it.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { buildComponent, type RegistryItem, type UpstreamItem } from './component.ts'
import { colorsUrl, type MirrorConfig, parseConfig, upstreamUrl } from './config.ts'
import { prepareExample } from './examples.ts'
import { globalStylesheets } from './globals.ts'
import { type HarnessExample, type HarnessInput, harnessFiles } from './harness.ts'
import {
  type BaseColor,
  type FontItem,
  layoutCss,
  projectCss,
  type StyleIndex,
} from './project-css.ts'
import { type Registry, upsertItems } from './registry.ts'
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

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
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

// Snapshot names beside the components: the style's index item, the font
// item, and the base color theme.
function themeSnapshots(config: MirrorConfig): [name: string, url: string][] {
  const font = `font-${config.theme.font}`
  return [
    ['index', upstreamUrl(config, 'index')],
    [font, upstreamUrl(config, font)],
    [`colors-${config.theme.baseColor}`, colorsUrl(config)],
  ]
}

async function fetchAll(io: Io, config: MirrorConfig): Promise<void> {
  const sources: [string, string][] = [
    ...config.components.map((name): [string, string] => [name, upstreamUrl(config, name)]),
    ...themeSnapshots(config),
  ]
  // Each component's docs example, when upstream has one: the A/B harness's
  // generated compositions.
  const examples = config.components.map((name): [string, string] => [
    `${name}-example`,
    upstreamUrl(config, `${name}-example`),
  ])
  for (const [name, url] of [...sources, ...examples]) {
    const response = await io.fetch(url)
    if (response.status === 404 && name.endsWith('-example')) {
      io.log(`no example for ${name.slice(0, -'-example'.length)}`)
      continue
    }
    if (!response.ok) throw new Error(`GET ${url}: ${response.status}`)
    await writeText(
      snapshotPath(io, config, name),
      `${JSON.stringify(await response.json(), null, 2)}\n`,
    )
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

async function readSnapshot<T>(io: Io, config: MirrorConfig, name: string): Promise<T> {
  return (await readJson(snapshotPath(io, config, name)).catch(() => {
    throw new Error(`no snapshot for ${config.upstream.style}/${name}; run mirror fetch first`)
  })) as T
}

async function readTypeset(io: Io, config: MirrorConfig, path: string): Promise<string> {
  return readFile(join(io.root, config.snapshotDir, 'typeset', path), 'utf8').catch(() => {
    throw new Error(`no snapshot for typeset/${path}; run mirror fetch first`)
  })
}

async function buildAll(io: Io, config: MirrorConfig): Promise<void> {
  const { style } = config.upstream
  const font = await readSnapshot<FontItem>(io, config, `font-${config.theme.font}`)
  const index = await readSnapshot<StyleIndex>(io, config, 'index')
  const colors = await readSnapshot<BaseColor>(io, config, `colors-${config.theme.baseColor}`)
  const css = projectCss(index, colors, font)
  await writeText(join(io.root, config.snapshotDir, style, 'index.css'), css)
  const compile = (candidates: string[]) => compileCandidates(css, candidates)

  const items: RegistryItem[] = []
  const harness: HarnessInput[] = []
  const classes = new Set<string>()
  for (const name of config.components) {
    const upstream = await readSnapshot<UpstreamItem>(io, config, name)
    const component = await buildComponent(upstream, config, compile)
    for (const file of component.files) await writeFormatted(io, file.path, file.content)
    for (const c of component.classes) classes.add(c)
    items.push(component.item)
    harness.push({
      name,
      upstreamSource: component.upstreamSource,
      transformed: component.transformed,
    })
    io.log(`built ${name}: ${component.files.map((file) => file.path).join(', ')}`)
    for (const [slot, unresolved] of Object.entries(component.unresolved)) {
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
      devDependencies: [],
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
  const examples: HarnessExample[] = []
  for (const name of config.components) {
    const example = `${name}-example`
    const item = await readJson(snapshotPath(io, config, example)).catch(() => undefined)
    if (item === undefined) continue
    const source = (item as UpstreamItem).files[0]?.content as string
    const prepared = prepareExample(source, style, config.namespace, mirrored)
    examples.push({ name: example, prepared })
    io.log(
      `example ${example}: ${prepared.kept.length} of ${prepared.kept.length + prepared.skipped.length} sub-examples`,
    )
    for (const { name: sub, missing } of prepared.skipped) {
      io.log(`  skipped ${sub}: needs ${missing.join(', ')}`)
    }
  }

  const typeset: TypesetFixture[] = []
  for (const name of config.typeset.fixtures) {
    typeset.push(...fixtureHtml(name, await readTypeset(io, config, `fixtures/${name}.ts`)))
  }

  const harnessHeader = `// Generated by scripts/mirror from shadcn ${style}. Do not edit.`
  const layout = layoutCss(index, colors, font, './examples/ours')
  for (const file of harnessFiles(
    config,
    { components: harness, examples, layoutCss: layout, typeset },
    harnessHeader,
  )) {
    await writeFormatted(io, file.path, file.content)
  }
  io.log(`built A/B harness inputs in ${config.harnessDir}`)

  const registry = upsertItems((await readJson(join(io.root, 'registry.json'))) as Registry, items)
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
