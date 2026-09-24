// mirror.config.json: which upstream style and components the mirror
// converts, and where it writes them. Validated by hand so a typo fails the
// run with the field name rather than surfacing later as `undefined`.

export type SelectorRewrite = {
  // Regular expression source, applied globally to each generated selector.
  pattern: RegExp
  replace: string
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
  selectorRewrites: SelectorRewrite[]
}

function fail(message: string): never {
  throw new Error(`mirror.config.json: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function string(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value === '') fail(`${path}${key} must be a non-empty string`)
  return value
}

export function parseConfig(raw: unknown): MirrorConfig {
  if (!isRecord(raw)) fail('must be an object')
  const upstream = raw.upstream
  if (!isRecord(upstream)) fail('upstream must be an object')
  const url = string(upstream, 'url', 'upstream.')
  if (!url.includes('{style}') || !url.includes('{name}')) {
    fail('upstream.url must contain {style} and {name}')
  }

  const colorsUrl = string(upstream, 'colorsUrl', 'upstream.')
  if (!colorsUrl.includes('{name}')) fail('upstream.colorsUrl must contain {name}')
  const theme = raw.theme
  if (!isRecord(theme)) fail('theme must be an object')

  const components = raw.components
  if (
    !Array.isArray(components) ||
    components.length === 0 ||
    !components.every((c) => typeof c === 'string' && /^[a-z0-9-]+$/.test(c))
  ) {
    fail('components must be a non-empty array of kebab-case item names')
  }

  const typeset = raw.typeset
  if (!isRecord(typeset)) fail('typeset must be an object')
  const fixturesUrl = string(typeset, 'fixturesUrl', 'typeset.')
  if (!fixturesUrl.includes('{name}')) fail('typeset.fixturesUrl must contain {name}')
  const fixtures = typeset.fixtures
  if (
    !Array.isArray(fixtures) ||
    !fixtures.every((f) => typeof f === 'string' && /^[a-z0-9-]+$/.test(f))
  ) {
    fail('typeset.fixtures must be an array of kebab-case names')
  }

  const rewrites = raw.selectorRewrites ?? []
  if (!Array.isArray(rewrites)) fail('selectorRewrites must be an array')
  const selectorRewrites = rewrites.map((rewrite, i) => {
    if (!isRecord(rewrite)) fail(`selectorRewrites[${i}] must be an object`)
    const replace = rewrite.replace
    if (typeof replace !== 'string') fail(`selectorRewrites[${i}].replace must be a string`)
    const source = string(rewrite, 'pattern', `selectorRewrites[${i}].`)
    let pattern: RegExp
    try {
      pattern = new RegExp(source, 'g')
    } catch {
      fail(`selectorRewrites[${i}].pattern is not a valid regular expression`)
    }
    return {
      pattern,
      replace,
      reason: string(rewrite, 'reason', `selectorRewrites[${i}].`),
    }
  })

  return {
    namespace: string(raw, 'namespace', ''),
    upstream: { url, colorsUrl, style: string(upstream, 'style', 'upstream.') },
    theme: {
      baseColor: string(theme, 'baseColor', 'theme.'),
      font: string(theme, 'font', 'theme.'),
    },
    components,
    typeset: { stylesheet: string(typeset, 'stylesheet', 'typeset.'), fixturesUrl, fixtures },
    snapshotDir: string(raw, 'snapshotDir', ''),
    outputDir: string(raw, 'outputDir', ''),
    globalsDir: string(raw, 'globalsDir', ''),
    harnessDir: string(raw, 'harnessDir', ''),
    selectorRewrites,
  }
}

export function upstreamUrl(config: MirrorConfig, name: string): string {
  return config.upstream.url.replace('{style}', config.upstream.style).replace('{name}', name)
}

export function colorsUrl(config: MirrorConfig): string {
  return config.upstream.colorsUrl.replace('{name}', config.theme.baseColor)
}
