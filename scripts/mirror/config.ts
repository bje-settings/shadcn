// mirror.config.json: which upstream style and components the mirror
// converts, and where it writes them. Validated by hand so a typo fails the
// run with the field name rather than surfacing later as `undefined`.

import { isRecord, KEBAB, Shape } from './parse.ts'

export type ConsumerClasses = {
  classes: string[]
  reason: string
}

export type MirrorConfig = {
  // This registry's name: cross-component imports and registryDependencies
  // point at @<namespace>/<item>.
  namespace: string
  upstream: {
    url: string
    // Base color themes, e.g. https://ui.shadcn.com/r/colors/{name}.json
    colorsUrl: string
    style: string
  }
  // The preset's theme choices (the shadcn CLI's `vega` preset is neutral + inter).
  theme: {
    baseColor: string
    font: string
    // Library the shadcn CLI swaps upstream's IconPlaceholder for, e.g. lucide
    iconLibrary: string
  }
  components: string[]
  // shadcn/typeset: the stylesheet (shipped as @<namespace>/typeset) and the
  // content fixtures its builder previews, which the A/B harness renders.
  typeset: {
    stylesheet: string
    fixturesUrl: string
    fixtures: string[]
  }
  snapshotDir: string
  outputDir: string
  // Generated global stylesheets (the @<namespace>/globals item)
  globalsDir: string
  // Generated inputs for the A/B harness
  harnessDir: string
  // Tailwind classes upstream styles gate on when a consumer passes them
  // (CardHeader pads once given `border-b`). No element carries them here, so
  // those rules are dropped and listed in the module's header, and A/B skips
  // the docs examples that pass them.
  consumerClasses: ConsumerClasses[]
  // Mirrored items whose component file is left out of coverage, with the
  // reason: upstream logic no render the docs example makes reaches (a
  // controlled value it never passes as a literal). vitest.config.ts reads it.
  coverageExclusions: Record<string, string>
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

export function parseConfig(raw: unknown): MirrorConfig {
  if (!isRecord(raw)) shape.fail('must be an object')
  const upstream = shape.record(raw.upstream, 'upstream')
  const url = string(upstream, 'url', 'upstream.')
  if (!url.includes('{style}') || !url.includes('{name}')) {
    shape.fail('upstream.url must contain {style} and {name}')
  }

  const colorsUrl = string(upstream, 'colorsUrl', 'upstream.')
  if (!colorsUrl.includes('{name}')) shape.fail('upstream.colorsUrl must contain {name}')
  const theme = shape.record(raw.theme, 'theme')

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

  const consumer = raw.consumerClasses ?? []
  if (!Array.isArray(consumer)) shape.fail('consumerClasses must be an array')
  const consumerClasses = consumer.map((value, i) => {
    const path = `consumerClasses[${i}]`
    const record = shape.record(value, path)
    return {
      classes: shape.strings(record.classes, `${path}.classes`),
      reason: string(record, 'reason', `${path}.`),
    }
  })

  const coverageExclusions =
    raw.coverageExclusions === undefined
      ? {}
      : shape.stringRecord(raw.coverageExclusions, 'coverageExclusions')
  for (const item of Object.keys(coverageExclusions)) {
    if (!components.includes(item)) {
      shape.fail(`coverageExclusions.${item} is not a configured component`)
    }
  }

  return {
    namespace: name(raw, 'namespace', ''),
    upstream: { url, colorsUrl, style: name(upstream, 'style', 'upstream.') },
    theme: {
      baseColor: name(theme, 'baseColor', 'theme.'),
      font: name(theme, 'font', 'theme.'),
      iconLibrary: name(theme, 'iconLibrary', 'theme.'),
    },
    components,
    typeset: { stylesheet: string(typeset, 'stylesheet', 'typeset.'), fixturesUrl, fixtures },
    snapshotDir: string(raw, 'snapshotDir', ''),
    outputDir: string(raw, 'outputDir', ''),
    globalsDir: string(raw, 'globalsDir', ''),
    harnessDir: string(raw, 'harnessDir', ''),
    consumerClasses,
    coverageExclusions,
  }
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
