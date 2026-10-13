// mirror.config.json: which upstream styles and components the mirror
// converts, and where it writes them. Validated by hand, so a missing required
// key or a malformed value fails the run with the field name. A key it does
// not read, a misspelled optional one included, is ignored.

import { isRecord, KEBAB, Shape } from './parse.ts'
import type { Literal } from './parts.ts'

export type TestSetup = {
  // Mirrored items whose generated test starts with these lines
  items: string[]
  lines: string[]
  reason: string
}

export type ClassList = {
  classes: string[]
  reason: string
}

// A style the mirror builds and publishes: an upstream style, which goes by its
// short name (vega for base-vega), or a derived one, which builds from an
// upstream style's snapshots under a name of its own (glass from base-maia).
export type BuiltStyle = {
  // The short name its output paths and published registry go by
  name: string
  // The upstream style whose snapshots it builds from
  base: string
}

export type MirrorConfig = {
  // This registry's name: cross-component imports and registryDependencies
  // point at @<namespace>/<item>.
  namespace: string
  upstream: {
    url: string
    // Base color themes, e.g. https://ui.shadcn.com/r/colors/{name}.json
    colorsUrl: string
    // The styles mirrored, each published as its own registry, tested and
    // compared with upstream
    styles: string[]
    // The upstream style this config builds from: the first as parsed, each
    // style's base from forStyle().
    style: string
  }
  // Styles built from an upstream style's snapshots under their own name,
  // after the upstream styles. None when unset.
  derived: BuiltStyle[]
  // The name this config's output paths and published registry go by: the
  // first style's as parsed, each style's own from forStyle().
  styleName: string
  // The preset's theme choices (the shadcn CLI's `vega` preset is neutral + inter).
  theme: {
    baseColor: string
    font: string
    // Library the shadcn CLI swaps upstream's IconPlaceholder for, e.g. lucide
    iconLibrary: string
  }
  // Upstream fonts each style publishes as @<namespace>/font-<name>, named as
  // upstream names them without the font- prefix (geist, heading-geist). None
  // when unset.
  fonts: string[]
  components: string[]
  // shadcn/typeset: the stylesheet (shipped as @<namespace>/typeset) and the
  // content fixtures its builder previews, which the A/B harness renders.
  typeset: {
    stylesheet: string
    fixturesUrl: string
    fixtures: string[]
  }
  // The blocks shadcn's /create page previews, fetched once for every style
  // and rendered on each style's showcase page with its own components.
  preview: {
    // A block file's URL, with {block} and {file} (index.tsx, cards/<name>.tsx)
    url: string
    // In the order the showcase's switcher numbers them; none when unset
    blocks: string[]
    // Modules the cards may import beyond the mirrored items' packages
    packages: string[]
  }
  snapshotDir: string
  // Output paths below take {style}, the style's short name (vega for
  // base-vega), until forStyle() resolves them.
  outputDir: string
  // Where mirrored hooks go (use-mobile)
  hooksDir: string
  // Generated global stylesheets (the @<namespace>/globals item)
  globalsDir: string
  // Generated inputs for the A/B harness, one directory per style
  harnessDir: string
  // The style's registry catalog: registry.json's hand-written items plus
  // the generated ones
  registryFile: string
  // Tailwind classes upstream styles gate on when a consumer passes them
  // (CardHeader pads once given `border-b`). No element carries them here, so
  // those rules are dropped and listed in the module's header, and A/B skips
  // the docs examples that pass them.
  consumerClasses: ClassList[]
  // Classes upstream's selectors name outside an element that a consumer's
  // markup carries as they are (`dark` on <html>, a visually hidden
  // `sr-only`): kept as :global() in the generated modules.
  globalClasses: ClassList[]
  // Upstream classes Tailwind compiles to nothing, upstream too (invalid
  // variant syntax, a breakpoint the theme lacks): dropped like group and peer
  // markers. Any other class without CSS fails the build.
  classesWithoutCss: ClassList[]
  // Mirrored items whose component file is left out of coverage, with the
  // reason: upstream logic no render the docs example makes reaches (a
  // controlled value it never passes as a literal). vitest.config.ts reads it.
  coverageExclusions: Record<string, string>
  // Props given to a part wherever generated tests and A/B fixtures render
  // it, by item and part: ones it needs that no example passes as a literal.
  testProps: Record<string, Record<string, Record<string, Literal>>>
  // Props given as TypeScript expressions in generated tests, by item and
  // part: values JSON cannot hold (CalendarDayButton's day, whose date is a
  // Date). A part given one is left out of the A/B fixtures; its item's docs
  // examples render it there.
  testExpressions: Record<string, Record<string, Record<string, string>>>
  // Props whose other values render the same under a part's scaffold, by
  // item and `Part.prop`, with the reason (Sidebar's collapsible shows only
  // once collapsed): their test checks the value renders, not a difference.
  sameRenderInTests: Record<string, Record<string, string>>
  // Exported parts jsdom renders nothing for under their scaffold, by item
  // and part, with the reason: their generated test checks they render
  // nothing.
  unrenderedInTests: Record<string, Record<string, string>>
  // Setup some generated tests need to run under jsdom, like a stub for a
  // browser API it lacks (cmdk observes resizes).
  testSetup: TestSetup[]
}

// Annotated so TypeScript treats shape.fail() as ending control flow.
const shape: Shape = new Shape('mirror.config.json')

function string(record: Record<string, unknown>, key: string, path: string): string {
  return shape.string(record[key], `${path}${key}`)
}

// Names that end up in paths, URLs and import specifiers.
function name(record: Record<string, unknown>, key: string, path: string): string {
  const value = string(record, key, path)
  if (!KEBAB.test(value)) shape.fail(`${path}${key} must be kebab-case`)
  return value
}

// A path each style writes its own copy of: it must name the style.
function styled(record: Record<string, unknown>, key: string): string {
  const value = string(record, key, '')
  if (!value.includes('{style}')) shape.fail(`${key} must contain {style}`)
  return value
}

// The name a style's output and published registry go by: vega for base-vega.
export function shortStyle(style: string): string {
  return style.replace(/^base-/, '')
}

// The upstream styles, each its own base, in config order: the styles
// `mirror fetch` snapshots.
export function upstreamStyles(config: MirrorConfig): BuiltStyle[] {
  return config.upstream.styles.map((style) => ({ name: shortStyle(style), base: style }))
}

// Every style the mirror builds, upstream styles first, then derived ones,
// each in config order.
export function builtStyles(config: MirrorConfig): BuiltStyle[] {
  return [...upstreamStyles(config), ...config.derived]
}

// The config one style builds with: its base as the upstream style, and its
// name in place of {style} in its output paths.
export function forStyle(config: MirrorConfig, style: BuiltStyle): MirrorConfig {
  const resolve = (path: string) => path.replaceAll('{style}', style.name)
  return {
    ...config,
    upstream: { ...config.upstream, style: style.base },
    styleName: style.name,
    outputDir: resolve(config.outputDir),
    hooksDir: resolve(config.hooksDir),
    globalsDir: resolve(config.globalsDir),
    harnessDir: resolve(config.harnessDir),
    registryFile: resolve(config.registryFile),
  }
}

export function parseConfig(raw: unknown): MirrorConfig {
  if (!isRecord(raw)) shape.fail('must be an object')
  const upstream = shape.record(raw.upstream, 'upstream')
  const url = string(upstream, 'url', 'upstream.')
  if (!url.includes('{style}') || !url.includes('{name}')) {
    shape.fail('upstream.url must contain {style} and {name}')
  }

  const colorsUrl = string(upstream, 'colorsUrl', 'upstream.')
  if (!colorsUrl.includes('{name}')) shape.fail('upstream.colorsUrl must contain {name}')
  const styles = upstream.styles
  if (
    !Array.isArray(styles) ||
    styles.length === 0 ||
    !styles.every((style) => typeof style === 'string' && KEBAB.test(style))
  ) {
    shape.fail('upstream.styles must be a non-empty array of kebab-case style names')
  }
  if (new Set(styles).size !== styles.length) shape.fail('upstream.styles must not repeat')
  const derived = parseDerived(raw.derived, styles)
  const theme = shape.record(raw.theme, 'theme')
  const fonts = raw.fonts ?? []
  if (!Array.isArray(fonts) || !fonts.every((f) => typeof f === 'string' && KEBAB.test(f))) {
    shape.fail('fonts must be an array of kebab-case font names')
  }
  if (new Set(fonts).size !== fonts.length) shape.fail('fonts must not repeat')

  const components = raw.components
  if (
    !Array.isArray(components) ||
    components.length === 0 ||
    !components.every((c) => typeof c === 'string' && KEBAB.test(c))
  ) {
    shape.fail('components must be a non-empty array of kebab-case item names')
  }
  if (new Set(components).size !== components.length) shape.fail('components must not repeat')

  const typeset = shape.record(raw.typeset, 'typeset')
  const fixturesUrl = string(typeset, 'fixturesUrl', 'typeset.')
  if (!fixturesUrl.includes('{name}')) shape.fail('typeset.fixturesUrl must contain {name}')
  const fixtures = typeset.fixtures
  if (!Array.isArray(fixtures) || !fixtures.every((f) => typeof f === 'string' && KEBAB.test(f))) {
    shape.fail('typeset.fixtures must be an array of kebab-case names')
  }

  const preview = parsePreview(raw.preview)

  const consumerClasses = classLists(raw, 'consumerClasses')
  const globalClasses = classLists(raw, 'globalClasses')
  const classesWithoutCss = classLists(raw, 'classesWithoutCss')

  const coverageExclusions =
    raw.coverageExclusions === undefined
      ? {}
      : shape.stringRecord(raw.coverageExclusions, 'coverageExclusions')
  for (const item of Object.keys(coverageExclusions)) {
    if (!components.includes(item)) {
      shape.fail(`coverageExclusions.${item} is not a configured component`)
    }
  }

  const setups = raw.testSetup ?? []
  if (!Array.isArray(setups)) shape.fail('testSetup must be an array')
  const testSetup = setups.map((value, i) => {
    const path = `testSetup[${i}]`
    const record = shape.record(value, path)
    const items = shape.strings(record.items, `${path}.items`)
    for (const item of items) {
      if (!components.includes(item))
        shape.fail(`${path}.items: ${item} is not a configured component`)
    }
    return {
      items,
      lines: shape.strings(record.lines, `${path}.lines`),
      reason: string(record, 'reason', `${path}.`),
    }
  })

  // Both are keyed by a configured item, then by one of its parts.
  const byItem = <T>(key: string, value: (raw: unknown, path: string) => T) => {
    const record = shape.record(raw[key] ?? {}, key)
    return Object.fromEntries(
      Object.entries(record).map(([item, parts]) => {
        if (!components.includes(item)) shape.fail(`${key}.${item} is not a configured component`)
        const path = `${key}.${item}`
        return [
          item,
          Object.fromEntries(
            Object.entries(shape.record(parts, path)).map(([part, v]) => [
              part,
              value(v, `${path}.${part}`),
            ]),
          ),
        ]
      }),
    )
  }
  const testProps = byItem('testProps', (value, path) => {
    const props = shape.record(value, path)
    for (const [prop, literal] of Object.entries(props)) {
      if (!isLiteral(literal)) shape.fail(`${path}.${prop} must be a JSON literal without null`)
    }
    return props as Record<string, Literal>
  })
  const testExpressions = byItem('testExpressions', (value, path) =>
    shape.stringRecord(value, path),
  )
  const sameRenderInTests = byItem('sameRenderInTests', (value, path) => shape.string(value, path))
  const unrenderedInTests = byItem('unrenderedInTests', (value, path) => shape.string(value, path))

  return {
    namespace: name(raw, 'namespace', ''),
    upstream: { url, colorsUrl, styles, style: styles[0] as string },
    derived,
    styleName: shortStyle(styles[0] as string),
    theme: {
      baseColor: name(theme, 'baseColor', 'theme.'),
      font: name(theme, 'font', 'theme.'),
      iconLibrary: name(theme, 'iconLibrary', 'theme.'),
    },
    fonts,
    components,
    typeset: { stylesheet: string(typeset, 'stylesheet', 'typeset.'), fixturesUrl, fixtures },
    preview,
    snapshotDir: string(raw, 'snapshotDir', ''),
    outputDir: styled(raw, 'outputDir'),
    hooksDir: styled(raw, 'hooksDir'),
    globalsDir: styled(raw, 'globalsDir'),
    harnessDir: styled(raw, 'harnessDir'),
    registryFile: styled(raw, 'registryFile'),
    consumerClasses,
    globalClasses,
    classesWithoutCss,
    coverageExclusions,
    testSetup,
    unrenderedInTests,
    sameRenderInTests,
    testProps,
    testExpressions,
  }
}

// Names a derived style cannot take: registry/lib is the shared library, and
// shared is CI's vitest leg for it and scripts/.
const RESERVED_NAMES = new Set(['lib', 'shared'])

// The optional derived key: each entry builds from one of upstream.styles
// under a name no other style goes by.
function parseDerived(raw: unknown, styles: string[]): BuiltStyle[] {
  const entries = raw ?? []
  if (!Array.isArray(entries)) shape.fail('derived must be an array')
  const upstreamNames = new Set(styles.map(shortStyle))
  const names = new Set<string>()
  return entries.map((value, i) => {
    const path = `derived[${i}]`
    const record = shape.record(value, path)
    const derivedName = name(record, 'name', `${path}.`)
    const base = string(record, 'base', `${path}.`)
    if (!styles.includes(base)) shape.fail(`${path}.base ${base} is not one of upstream.styles`)
    if (upstreamNames.has(derivedName)) {
      shape.fail(`${path}.name ${derivedName} is an upstream style's short name`)
    }
    if (RESERVED_NAMES.has(derivedName)) shape.fail(`${path}.name ${derivedName} is reserved`)
    if (names.has(derivedName)) shape.fail(`${path}.name ${derivedName} repeats a derived name`)
    names.add(derivedName)
    return { name: derivedName, base }
  })
}

// The optional preview key: unset previews no block.
function parsePreview(raw: unknown): MirrorConfig['preview'] {
  if (raw === undefined) return { url: '', blocks: [], packages: [] }
  const preview = shape.record(raw, 'preview')
  const url = string(preview, 'url', 'preview.')
  if (!url.includes('{block}') || !url.includes('{file}')) {
    shape.fail('preview.url must contain {block} and {file}')
  }
  const blocks = preview.blocks
  if (
    !Array.isArray(blocks) ||
    blocks.length === 0 ||
    !blocks.every((block) => typeof block === 'string' && KEBAB.test(block))
  ) {
    shape.fail('preview.blocks must be a non-empty array of kebab-case block names')
  }
  if (new Set(blocks).size !== blocks.length) shape.fail('preview.blocks must not repeat')
  const packages = shape.strings(preview.packages ?? [], 'preview.packages')
  return { url, blocks, packages }
}

// A preview block file's URL.
export function previewUrl(config: MirrorConfig, block: string, file: string): string {
  return config.preview.url.replace('{block}', block).replace('{file}', file)
}

// An optional array of { classes, reason } entries.
function classLists(raw: Record<string, unknown>, key: string): ClassList[] {
  const lists = raw[key] ?? []
  if (!Array.isArray(lists)) shape.fail(`${key} must be an array`)
  return lists.map((value, i) => {
    const path = `${key}[${i}]`
    const record = shape.record(value, path)
    return {
      classes: shape.strings(record.classes, `${path}.classes`),
      reason: string(record, 'reason', `${path}.`),
    }
  })
}

function isLiteral(value: unknown): value is Literal {
  if (['string', 'number', 'boolean'].includes(typeof value)) return true
  if (Array.isArray(value)) return value.every(isLiteral)
  return isRecord(value) && Object.values(value).every(isLiteral)
}

// Every part the test config names, by item, must be one the item exports:
// an entry for a renamed or removed part would otherwise do nothing.
export function checkConfiguredParts(
  config: MirrorConfig,
  exported: (item: string) => Set<string>,
): void {
  const byItem = {
    testProps: config.testProps,
    testExpressions: config.testExpressions,
    unrenderedInTests: config.unrenderedInTests,
    sameRenderInTests: config.sameRenderInTests,
  }
  for (const [key, items] of Object.entries(byItem)) {
    for (const [item, parts] of Object.entries(items)) {
      const names = exported(item)
      // sameRenderInTests keys are `Part.prop`.
      for (const part of Object.keys(parts).map((k) => k.split('.')[0] as string)) {
        if (!names.has(part)) shape.fail(`${key}.${item}.${part} is not a part ${item} exports`)
      }
    }
  }
}

// The built style a name (luma, glass) names; `source` says where the name
// came from, for the error.
export function namedStyle(config: MirrorConfig, name: string, source: string): BuiltStyle {
  const styles = builtStyles(config)
  const style = styles.find((style) => style.name === name)
  if (style === undefined) {
    throw new Error(`${source}: ${name} is not one of ${styles.map((s) => s.name).join(', ')}`)
  }
  return style
}

// The style an A/B run renders: the one AB_STYLE names, or the first upstream
// style when it is unset, so a derived style is never the default.
export function harnessStyle(config: MirrorConfig, name: string | undefined): BuiltStyle {
  if (name === undefined) return upstreamStyles(config)[0] as BuiltStyle
  return namedStyle(config, name, 'AB_STYLE')
}

// The port an A/B run serves a style on: 4400 plus its index in every built
// style, so a server left running for one style is never reused for another.
// A style not built has no port of its own, so it is refused.
export function harnessPort(config: MirrorConfig, style: BuiltStyle): number {
  const names = builtStyles(config).map(({ name }) => name)
  const index = names.indexOf(style.name)
  if (index === -1) throw new Error(`harnessPort: ${style.name} is not one of ${names.join(', ')}`)
  return 4400 + index
}

export function upstreamUrl(config: MirrorConfig, name: string): string {
  return config.upstream.url.replace('{style}', config.upstream.style).replace('{name}', name)
}

// The reason each consumer class's rules are dropped, by class.
export function consumerClassReasons(config: MirrorConfig): Map<string, string> {
  return new Map(
    config.consumerClasses.flatMap(({ classes, reason }) => classes.map((c) => [c, reason])),
  )
}

export function colorsUrl(config: MirrorConfig): string {
  return config.upstream.colorsUrl.replace('{name}', config.theme.baseColor)
}
