// mirror.config.json: which upstream style and components the mirror
// converts, and where it writes them. Validated by hand so a typo fails the
// run with the field name rather than surfacing later as `undefined`.

export type SelectorRewrite = {
  find: string
  replace: string
  reason: string
}

export type MirrorConfig = {
  upstream: {
    url: string
    style: string
  }
  components: string[]
  snapshotDir: string
  outputDir: string
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

  const components = raw.components
  if (
    !Array.isArray(components) ||
    components.length === 0 ||
    !components.every((c) => typeof c === 'string' && /^[a-z0-9-]+$/.test(c))
  ) {
    fail('components must be a non-empty array of kebab-case item names')
  }

  const rewrites = raw.selectorRewrites ?? []
  if (!Array.isArray(rewrites)) fail('selectorRewrites must be an array')
  const selectorRewrites = rewrites.map((rewrite, i) => {
    if (!isRecord(rewrite)) fail(`selectorRewrites[${i}] must be an object`)
    const replace = rewrite.replace
    if (typeof replace !== 'string') fail(`selectorRewrites[${i}].replace must be a string`)
    return {
      find: string(rewrite, 'find', `selectorRewrites[${i}].`),
      replace,
      reason: string(rewrite, 'reason', `selectorRewrites[${i}].`),
    }
  })

  return {
    upstream: { url, style: string(upstream, 'style', 'upstream.') },
    components,
    snapshotDir: string(raw, 'snapshotDir', ''),
    outputDir: string(raw, 'outputDir', ''),
    selectorRewrites,
  }
}

export function upstreamUrl(config: MirrorConfig, name: string): string {
  return config.upstream.url.replace('{style}', config.upstream.style).replace('{name}', name)
}
