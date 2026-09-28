import { describe, expect, it } from 'vitest'
import {
  checkConfiguredParts,
  colorsUrl,
  consumerClassReasons,
  forStyle,
  parseConfig,
  shortStyle,
  upstreamUrl,
} from './config.ts'

const valid = {
  namespace: 'bje',
  upstream: {
    url: 'https://example.com/{style}/{name}.json',
    colorsUrl: 'https://example.com/colors/{name}.json',
    styles: ['base-vega', 'base-luma'],
    compare: 'base-vega',
  },
  theme: { baseColor: 'neutral', font: 'inter', iconLibrary: 'lucide' },
  components: ['button', 'icon-button'],
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
  consumerClasses: [{ classes: ['border-b'], reason: 'consumer' }],
  coverageExclusions: { button: 'why' },
  globalClasses: [{ classes: ['dark'], reason: 'dark mode' }],
  classesWithoutCss: [{ classes: ['xs:flex'], reason: 'no xs breakpoint' }],
  testSetup: [{ items: ['button'], lines: ['stub()'], reason: 'jsdom' }],
  unrenderedInTests: { button: { Button: 'why' } },
  testProps: { button: { Button: { size: 'sm' } } },
  testExpressions: { button: { Button: { day: 'new Date()' } } },
  sameRenderInTests: { button: { 'Button.size': 'why' } },
}

function withChange(change: Record<string, unknown>) {
  return { ...valid, ...change }
}

describe('parseConfig', () => {
  it('accepts a valid config and builds item URLs', () => {
    const config = parseConfig(valid)
    // As parsed, the config builds the compare style.
    expect(config).toEqual({ ...valid, upstream: { ...valid.upstream, style: 'base-vega' } })
    expect(upstreamUrl(config, 'button')).toBe('https://example.com/base-vega/button.json')
    expect(colorsUrl(config)).toBe('https://example.com/colors/neutral.json')
  })

  it('defaults consumerClasses and coverageExclusions to none', () => {
    const config = parseConfig(
      withChange({
        consumerClasses: undefined,
        coverageExclusions: undefined,
        testSetup: undefined,
        unrenderedInTests: undefined,
        testProps: undefined,
      }),
    )
    expect(config.testProps).toEqual({})
    expect(config.coverageExclusions).toEqual({})
    expect(config.testSetup).toEqual([])
    expect(config.unrenderedInTests).toEqual({})
    expect(config.consumerClasses).toEqual([])
    expect(consumerClassReasons(parseConfig(valid))).toEqual(new Map([['border-b', 'consumer']]))
  })

  it.each([
    ['a non-object', null, 'must be an object'],
    ['a missing upstream', withChange({ upstream: 'x' }), 'upstream must be an object'],
    [
      'a missing url',
      withChange({ upstream: { styles: ['base-vega'], compare: 'base-vega' } }),
      'upstream.url must be a non-empty string',
    ],
    [
      'a url without placeholders',
      withChange({ upstream: { ...valid.upstream, url: 'https://example.com' } }),
      'must contain {style} and {name}',
    ],
    [
      'a url without {name}',
      withChange({ upstream: { ...valid.upstream, url: 'https://example.com/{style}' } }),
      'must contain {style} and {name}',
    ],
    [
      'a colorsUrl without {name}',
      withChange({ upstream: { ...valid.upstream, colorsUrl: 'https://example.com/colors' } }),
      'upstream.colorsUrl must contain {name}',
    ],
    ['a missing theme', withChange({ theme: 'neutral' }), 'theme must be an object'],
    [
      'a theme without a font',
      withChange({ theme: { baseColor: 'neutral' } }),
      'theme.font must be',
    ],
    ['non-array components', withChange({ components: 'button' }), 'components must be'],
    ['empty components', withChange({ components: [] }), 'components must be'],
    ['non-kebab components', withChange({ components: ['Button'] }), 'components must be'],
    ['repeated components', withChange({ components: ['a', 'a'] }), 'components must not repeat'],
    ['a non-kebab namespace', withChange({ namespace: 'Bje' }), 'namespace must be kebab-case'],
    [
      'non-array styles',
      withChange({ upstream: { ...valid.upstream, styles: 'base-vega' } }),
      'upstream.styles must be a non-empty array of kebab-case style names',
    ],
    [
      'empty styles',
      withChange({ upstream: { ...valid.upstream, styles: [] } }),
      'upstream.styles must be a non-empty array of kebab-case style names',
    ],
    [
      'a non-kebab style',
      withChange({ upstream: { ...valid.upstream, styles: ['base/vega'] } }),
      'upstream.styles must be a non-empty array of kebab-case style names',
    ],
    [
      'repeated styles',
      withChange({ upstream: { ...valid.upstream, styles: ['base-vega', 'base-vega'] } }),
      'upstream.styles must not repeat',
    ],
    [
      'a compare style that is not listed',
      withChange({ upstream: { ...valid.upstream, compare: 'base-nova' } }),
      'upstream.compare: base-nova is not in upstream.styles',
    ],
    [
      'an output path without {style}',
      withChange({ outputDir: 'registry/ui' }),
      'outputDir must contain {style}',
    ],
    [
      'a theme without an icon library',
      withChange({ theme: { baseColor: 'neutral', font: 'inter' } }),
      'theme.iconLibrary must be',
    ],
    ['non-array consumer classes', withChange({ consumerClasses: {} }), 'consumerClasses must be'],
    [
      'consumer classes without a reason',
      withChange({ consumerClasses: [{ classes: ['a'] }] }),
      'consumerClasses[0].reason',
    ],
    ['a non-array testSetup', withChange({ testSetup: {} }), 'testSetup must be an array'],
    [
      'unrendered parts of an item not configured',
      withChange({ unrenderedInTests: { card: { Card: 'x' } } }),
      'unrenderedInTests.card is not a configured component',
    ],
    [
      'a non-string unrendered reason',
      withChange({ unrenderedInTests: { button: { Button: 1 } } }),
      'unrenderedInTests.button.Button must be a non-empty string',
    ],
    [
      'a null test prop',
      withChange({ testProps: { button: { Button: { size: null } } } }),
      'testProps.button.Button.size must be a JSON literal without null',
    ],
    [
      'a nested null test prop',
      withChange({ testProps: { button: { Button: { list: [{ a: null }] } } } }),
      'testProps.button.Button.list must be a JSON literal without null',
    ],
    [
      'non-object test props',
      withChange({ testProps: { button: { Button: 'x' } } }),
      'testProps.button.Button must be an object',
    ],
    [
      'a testSetup item not configured',
      withChange({ testSetup: [{ items: ['card'], lines: [], reason: 'x' }] }),
      'testSetup[0].items: card is not a configured component',
    ],
    [
      'a coverage exclusion for an item not configured',
      withChange({ coverageExclusions: { card: 'why' } }),
      'coverageExclusions.card is not a configured component',
    ],
    ['a missing namespace', withChange({ namespace: '' }), 'namespace must be'],
    ['a missing typeset', withChange({ typeset: [] }), 'typeset must be an object'],
    [
      'a typeset fixturesUrl without {name}',
      withChange({ typeset: { ...valid.typeset, fixturesUrl: 'https://example.com/x.ts' } }),
      'typeset.fixturesUrl must contain {name}',
    ],
    [
      'non-kebab typeset fixtures',
      withChange({ typeset: { ...valid.typeset, fixtures: ['Docs'] } }),
      'typeset.fixtures must be',
    ],
    [
      'a non-array of typeset fixtures',
      withChange({ typeset: { ...valid.typeset, fixtures: 'docs' } }),
      'typeset.fixtures must be',
    ],
    ['a missing outputDir', withChange({ outputDir: '' }), 'outputDir must be'],
  ])('rejects %s', (_, raw, message) => {
    expect(() => parseConfig(raw)).toThrow(message)
  })
})

describe('forStyle', () => {
  it("sets the style and resolves its output paths with the style's short name", () => {
    const luma = forStyle(parseConfig(valid), 'base-luma')
    expect(luma.upstream).toMatchObject({ style: 'base-luma', compare: 'base-vega' })
    expect(luma).toMatchObject({
      outputDir: 'registry/luma/ui',
      hooksDir: 'registry/luma/hooks',
      globalsDir: 'registry/luma/styles',
      registryFile: 'registry/luma/registry.json',
      harnessDir: 'ab/generated',
    })
  })
})

describe('shortStyle', () => {
  it('drops the base- prefix, and keeps a name without one', () => {
    expect(shortStyle('base-vega')).toBe('vega')
    expect(shortStyle('new-york')).toBe('new-york')
  })
})

describe('checkConfiguredParts', () => {
  const config = parseConfig(valid)

  it('accepts parts the items export, and a Part.prop key by its part', () => {
    expect(() => checkConfiguredParts(config, () => new Set(['Button']))).not.toThrow()
  })

  it('names a configured part the item does not export', () => {
    expect(() => checkConfiguredParts(config, () => new Set(['Other']))).toThrow(
      'testProps.button.Button is not a part button exports',
    )
  })
})
