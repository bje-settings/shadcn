// `mirror fetch` snapshots, for each configured style, the upstream items, their
// docs examples, the style index, the theme's font and each published one, the
// base color, and shadcn/typeset and the /create preview blocks once, into the
// repo; `mirror fetch preview` snapshots the preview blocks alone. `mirror
// build` reads only those snapshots and writes each style's project CSS,
// components, global stylesheets, typeset, font stylesheets, tsconfig, registry
// catalog, A/B harness inputs and showcase inputs, so a conversion change is
// reviewable without upstream moving underneath it.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import {
  buildComponent,
  markerSelectors,
  prepareComponent,
  type RegistryItem,
  sharedSlotOptions,
} from './component.ts'
import {
  builtStyles,
  checkConfiguredParts,
  colorsUrl,
  forStyle,
  type MirrorConfig,
  namedStyle,
  parseConfig,
  previewUrl,
  shortStyle,
  upstreamUrl,
} from './config.ts'
import { prepareExample } from './examples.ts'
import { fontStylesheet, globalStylesheets } from './globals.ts'
import { type HarnessExample, type HarnessInput, harnessFiles } from './harness.ts'
import { checkCollisions } from './internal.ts'
import { pascalCase } from './names.ts'
import { type PartTypes, partTypes, scaffolds } from './parts.ts'
import { CARD_REGISTRY, previewCards, type ShowcaseCard, skippedCards } from './preview.ts'
import { layoutCss, projectCss, staticTheme } from './project-css.ts'
import { parseRegistry, styleRegistry } from './registry.ts'
import { registrations } from './scss.ts'
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

// The sub-examples the A/B harness skips for a style, with why.
export function skippedExamplesPath(config: MirrorConfig): string {
  return `ab/skipped-examples/${config.styleName}.json`
}

// The preview cards each style's showcase leaves out, with why.
export function skippedCardsPath(config: MirrorConfig): string {
  return `ab/skipped-cards/${config.styleName}.json`
}

function snapshotPath(io: Io, config: MirrorConfig, name: string): string {
  return join(io.root, config.snapshotDir, config.upstream.style, `${name}.json`)
}

function missingSnapshot(name: string): never {
  throw new Error(`no snapshot for ${name}; run mirror fetch first`)
}

type Source = { name: string; url: string; parse: Parse<unknown>; optional?: boolean }

// Everything `fetch` snapshots as JSON: each component, the style's index
// item, the theme's font and each published one, the base color, and each
// component's docs example (the A/B harness's example cases) when upstream has
// one.
function sources(config: MirrorConfig): Source[] {
  const fonts = new Set([config.theme.font, ...config.fonts])
  return [
    ...config.components.map((name) => ({
      name,
      url: upstreamUrl(config, name),
      parse: parseUpstreamItem,
    })),
    { name: 'index', url: upstreamUrl(config, 'index'), parse: parseStyleIndex },
    ...[...fonts].map((font) => ({
      name: `font-${font}`,
      url: upstreamUrl(config, `font-${font}`),
      parse: parseFontItem,
    })),
    { name: `colors-${config.theme.baseColor}`, url: colorsUrl(config), parse: parseBaseColor },
    ...config.components.map((name) => ({
      name: `${name}-example`,
      url: upstreamUrl(config, `${name}-example`),
      parse: parseUpstreamItem,
      optional: true,
    })),
  ]
}

async function fetchStyle(io: Io, config: MirrorConfig): Promise<void> {
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
}

async function fetchText(io: Io, url: string): Promise<string> {
  const response = await io.fetch(url)
  if (!response.ok) throw new Error(`GET ${url}: ${response.status}`)
  return response.text()
}

// shadcn/typeset is one stylesheet for every style.
async function fetchTypeset(io: Io, config: MirrorConfig): Promise<void> {
  const typeset: [string, string][] = [
    ['typeset.css', config.typeset.stylesheet],
    ...config.typeset.fixtures.map((name): [string, string] => [
      `fixtures/${name}.ts`,
      config.typeset.fixturesUrl.replace('{name}', name),
    ]),
  ]
  for (const [path, url] of typeset) {
    await writeText(join(io.root, config.snapshotDir, 'typeset', path), await fetchText(io, url))
    io.log(`fetched typeset/${path}`)
  }
}

function previewPath(io: Io, config: MirrorConfig, path: string): string {
  return join(io.root, config.snapshotDir, 'preview', path)
}

// The preview blocks are the same for every style: each block's index and
// every card it imports. All are fetched before the directory is replaced, so
// a failed fetch leaves the snapshots as they were, and a card or block no
// longer previewed goes.
async function fetchPreview(io: Io, config: MirrorConfig): Promise<void> {
  const files: [string, string][] = []
  for (const block of config.preview.blocks) {
    const index = await fetchText(io, previewUrl(config, block, 'index.tsx'))
    files.push([`${block}/index.tsx`, index])
    for (const { file } of previewCards(block, index)) {
      files.push([`${block}/${file}`, await fetchText(io, previewUrl(config, block, file))])
    }
  }
  await rm(previewPath(io, config, ''), { recursive: true, force: true })
  for (const [path, text] of files) {
    await writeText(previewPath(io, config, path), text)
    io.log(`fetched preview/${path}`)
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

async function readPreview(io: Io, config: MirrorConfig, path: string): Promise<string> {
  const text = await readOptional(previewPath(io, config, path))
  return text ?? missingSnapshot(`preview/${path}`)
}

// Each preview card prepared like a docs example, with this style's
// components in place of upstream's base ones. Cards may also import the
// configured preview packages.
async function prepareCards(
  io: Io,
  config: MirrorConfig,
  mirrored: Set<string>,
  dropped: Map<string, Set<string>>,
  packages: Set<string>,
): Promise<ShowcaseCard[]> {
  const allowed = new Set([...packages, ...config.preview.packages])
  const cards: ShowcaseCard[] = []
  for (const block of config.preview.blocks) {
    for (const card of previewCards(block, await readPreview(io, config, `${block}/index.tsx`))) {
      const source = await readPreview(io, config, `${block}/${card.file}`)
      const ns = config.namespace
      const prepared = prepareExample(source, CARD_REGISTRY, ns, mirrored, dropped, allowed)
      cards.push({ block, card, prepared })
    }
  }
  return cards
}

// The compilerOptions each style's registry/<style>/tsconfig.json resolves its
// cross-component imports with, as registry/tsconfig.json does for lib.
function styleTsconfig(config: MirrorConfig): string {
  const dir = dirname(config.registryFile)
  const path = (target: string) => `./${relative(dir, target)}/*`
  const tsconfig = {
    extends: '../tsconfig.json',
    compilerOptions: {
      paths: {
        [`@/registry/${config.namespace}/ui/*`]: [path(config.outputDir)],
        [`@/registry/${config.namespace}/hooks/*`]: [path(config.hooksDir)],
      },
    },
    include: ['.', '../../types'],
  }
  return `${JSON.stringify(tsconfig, null, 2)}\n`
}

async function buildStyle(io: Io, config: MirrorConfig): Promise<void> {
  const { style } = config.upstream
  const font = await readSnapshot(io, config, `font-${config.theme.font}`, parseFontItem)
  // Every published font is read before anything is written, so a missing
  // snapshot leaves the style's output as it was.
  const fonts = []
  for (const name of config.fonts) {
    fonts.push({ name, snapshot: await readSnapshot(io, config, `font-${name}`, parseFontItem) })
  }
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
  checkConfiguredParts(config, (item) => new Set(types.get(item)?.keys()))

  const items: RegistryItem[] = []
  const harness: HarnessInput[] = []
  const classes = new Set<string>()
  const internal = new Set<string>()
  const external = new Set<string>()
  // The consumer classes each item's dropped rules gate on, by item.
  const dropped = new Map<string, Set<string>>()
  const allClasses = prepared.flatMap(({ transformed }) =>
    transformed.slots.flatMap((s) => s.classes),
  )
  const shared = sharedSlotOptions(
    config,
    prepared,
    registrations(await compile([...new Set(allClasses)].sort())),
  )
  for (const component of prepared) {
    const { name } = component.upstream
    const itemTypes = types.get(name) as Map<string, PartTypes>
    const context = {
      slotOptions: { ...shared, markers: markerSelectors(prepared, component) },
      types: itemTypes,
      scaffolds: scaffolds(
        name,
        exampleSources.get(name),
        itemTypes,
        component.transformed,
        config.testProps[name],
      ),
      external: new Map(
        // Every registry import is a mirrored item, which partTypes covers.
        component.transformed.registryImports.flatMap((item) => [
          ...(types.get(item) as Map<string, PartTypes>),
        ]),
      ),
    }
    const built = await buildComponent(component, config, compile, context)
    // The component's folder is all generated: clear it so a file the
    // pipeline stopped writing (a module for a component that lost its
    // classes) does not linger.
    if (component.upstream.type === 'registry:ui') {
      await rm(join(io.root, config.outputDir, pascalCase(name)), { recursive: true, force: true })
    }
    for (const file of built.files) await writeFormatted(io, file.path, file.content)
    for (const c of built.classes) classes.add(c)
    for (const name of built.internal) internal.add(name)
    for (const name of built.external) external.add(name)
    items.push(built.item)
    harness.push(
      component.upstream.type === 'registry:hook'
        ? { kind: 'hook', name, upstreamSource: built.upstreamSource }
        : {
            kind: 'ui',
            name,
            upstreamSource: built.upstreamSource,
            transformed: built.transformed,
            types: itemTypes,
            scaffolds: context.scaffolds,
            expressionParts: Object.keys(config.testExpressions[name] ?? {}),
          },
    )
    io.log(`built ${name}: ${built.files.map((file) => file.path).join(', ')}`)
    for (const [slot, unresolved] of Object.entries(built.unresolved)) {
      io.log(`  ${slot}: no CSS for ${unresolved.join(' ')}`)
    }
    for (const reason of built.dropped) io.log(`  dropped rules: ${reason}`)
    if (built.gated.length > 0) dropped.set(name, new Set(built.gated))
  }

  // A derived style goes by a name other than its base's, and says so.
  const source = config.styleName === shortStyle(style) ? style : `${style} as ${config.styleName}`
  const header = `// Generated by scripts/mirror from shadcn ${source} (${config.theme.baseColor}, ${config.theme.font}). Do not edit.`
  // Typeset is imported after Tailwind upstream, which makes Tailwind emit the
  // theme variables it reads (--color-foreground, --font-heading, ...).
  const typesetCss = await readTypeset(io, config, 'typeset.css')
  // A static theme emits Tailwind's whole default theme, not only the values
  // these classes read, so a consumer's global stylesheet is the full set.
  const sheets = globalStylesheets(
    await compileCandidates(staticTheme(`${css}\n${typesetCss}`), [...classes].sort()),
    header,
  )
  for (const [, name] of sheets.variables.matchAll(/(--[\w-]+)\s*:/g)) external.add(name as string)
  checkCollisions(internal, external)
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

  // Each published font is an item of its own, so the theme's font in globals
  // stays the default. The directory is all generated: clear it so a font
  // dropped from the config goes with its stylesheet.
  const fontsDir = `${config.globalsDir}/fonts`
  await rm(join(io.root, fontsDir), { recursive: true, force: true })
  for (const { name, snapshot } of fonts) {
    const upstream = `font-${name}`
    const path = `${fontsDir}/${name}.css`
    const header = `/* Generated by scripts/mirror from shadcn ${style}/${upstream}. Do not edit. */`
    await writeFormatted(io, path, fontStylesheet(snapshot, header))
    items.push({
      name: upstream,
      type: 'registry:file',
      title: snapshot.title,
      dependencies: [snapshot.font.dependency],
      devDependencies: [],
      registryDependencies: [`@${config.namespace}/globals`],
      files: [{ path, type: 'registry:file', target: `@components/styles/fonts/${name}.css` }],
    })
  }
  if (config.fonts.length > 0) io.log(`built ${config.fonts.length} fonts in ${fontsDir}`)

  const mirrored = new Set(config.components)
  // Packages mirrored items import or upstream lists for them (date-fns for
  // Calendar), without version pins (recharts@3.8.0).
  const packages = new Set(
    [
      ...items.flatMap((item) => item.dependencies),
      ...prepared.flatMap(({ upstream }) => upstream.dependencies ?? []),
    ].map((dependency) => dependency.replace(/(?<=.)@[^@]*$/, '')),
  )
  const examples: HarnessExample[] = []
  const skippedExamples: Record<string, Record<string, string[]>> = {}
  for (const [name, source] of exampleSources) {
    if (source === undefined) continue
    const example = `${name}-example`
    const prepared = prepareExample(source, style, config.namespace, mirrored, dropped, packages)
    examples.push({ name: example, prepared })
    io.log(
      `example ${example}: ${prepared.kept.length} of ${prepared.kept.length + prepared.skipped.length} sub-examples`,
    )
    for (const { name: sub, reasons } of prepared.skipped) {
      io.log(`  skipped ${sub}: ${reasons.join('; ')}`)
      skippedExamples[example] = { ...skippedExamples[example], [sub]: reasons }
    }
  }

  const cards = await prepareCards(io, config, mirrored, dropped, packages)
  const skipped = skippedCards(cards)
  const skips = Object.values(skipped).flatMap(Object.keys).length
  io.log(`showcase: ${cards.length - skips} of ${cards.length} cards`)
  for (const [block, reasons] of Object.entries(skipped)) {
    for (const [card, why] of Object.entries(reasons)) {
      io.log(`  skipped ${block}/${card}: ${why.join('; ')}`)
    }
  }

  const typeset: TypesetFixture[] = []
  for (const name of config.typeset.fixtures) {
    typeset.push(...fixtureHtml(name, await readTypeset(io, config, `fixtures/${name}.ts`)))
  }

  const harnessHeader = `// Generated by scripts/mirror from shadcn ${style}. Do not edit.`
  const layout = layoutCss(index, colors, font, './examples/ours')
  const showcase = {
    cards,
    indexes: Object.fromEntries(
      await Promise.all(
        config.preview.blocks.map(
          async (block) => [block, await readPreview(io, config, `${block}/index.tsx`)] as const,
        ),
      ),
    ),
    layoutCss: layoutCss(index, colors, font, './showcase'),
    fontTitle: font.title,
  }
  const inputs = { components: harness, examples, layoutCss: layout, typeset, showcase }
  // Not formatted: the harness inputs are gitignored, so no review or
  // `biome ci` reads them, and Biome refuses to fix an ignored path that exists.
  for (const file of harnessFiles(config, inputs, harnessHeader)) {
    await writeText(join(io.root, file.path), file.content)
  }
  io.log(`built A/B harness inputs in ${config.harnessDir}`)
  // Committed, so a skip that appears shows in review and fails
  // generated.test.ts until it is recorded.
  await writeFormatted(
    io,
    skippedExamplesPath(config),
    `${JSON.stringify(skippedExamples, null, 2)}\n`,
  )
  await writeFormatted(io, skippedCardsPath(config), `${JSON.stringify(skipped, null, 2)}\n`)

  // registry.json holds the hand-written items; each style publishes them with
  // its own under its path of the site.
  const basePath = join(io.root, 'registry.json')
  const base = parseRegistry(await readJson(basePath), basePath)
  const registry = styleRegistry(base, items, config.styleName)
  await writeFormatted(io, config.registryFile, `${JSON.stringify(registry, null, 2)}\n`)
  const tsconfig = join(dirname(config.registryFile), 'tsconfig.json')
  await writeFormatted(io, tsconfig, styleTsconfig(config))
  io.log(`built ${config.registryFile}, ${tsconfig}`)
}

export async function run(args: string[], io: Io): Promise<void> {
  const [command, ...rest] = args
  const [only] = rest
  const usage =
    command === 'build'
      ? rest.length <= 1
      : command === 'fetch' && (rest.length === 0 || (rest.length === 1 && only === 'preview'))
  if (!usage) throw new Error('usage: mirror <fetch [preview]|build [style]>')
  const config = parseConfig(await readJson(join(io.root, 'mirror.config.json')))
  // `fetch preview` refreshes the preview blocks and leaves every other
  // snapshot as it is.
  if (only === 'preview' && command === 'fetch') return fetchPreview(io, config)
  if (command === 'fetch') {
    // Derived styles have no upstream of their own: their base's snapshots
    // are theirs.
    for (const style of config.upstream.styles) {
      await fetchStyle(io, forStyle(config, { name: shortStyle(style), base: style }))
    }
    await fetchTypeset(io, config)
    await fetchPreview(io, config)
    return
  }
  // `build <style>` builds that style alone, for an A/B run of one style.
  const styles =
    only === undefined ? builtStyles(config) : [namedStyle(config, only, 'mirror build')]
  for (const style of styles) await buildStyle(io, forStyle(config, style))
}
