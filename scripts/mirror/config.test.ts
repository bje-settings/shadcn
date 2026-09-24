import { describe, expect, it } from 'vitest'
import { colorsUrl, parseConfig, upstreamUrl } from './config.ts'

const valid = {
  namespace: 'bje',
  upstream: {
    url: 'https://example.com/{style}/{name}.json',
    colorsUrl: 'https://example.com/colors/{name}.json',
    style: 'base-vega',
  },
  theme: { baseColor: 'neutral', font: 'inter' },
  components: ['button', 'icon-button'],
  typeset: {
    stylesheet: 'https://example.com/typeset.css',
    fixturesUrl: 'https://example.com/fixtures/{name}.ts',
    fixtures: ['docs'],
  },
  snapshotDir: 'upstream',
  outputDir: 'registry/ui',
  globalsDir: 'registry/styles',
  harnessDir: 'ab/generated',
  selectorRewrites: [{ pattern: 'a+', replace: '', reason: 'why' }],
}

function withChange(change: Record<string, unknown>) {
  return { ...valid, ...change }
}

describe('parseConfig', () => {
  it('accepts a valid config and builds item URLs', () => {
    const config = parseConfig(valid)
    expect(config).toEqual({
      ...valid,
      selectorRewrites: [{ pattern: /a+/g, replace: '', reason: 'why' }],
    })
    expect(upstreamUrl(config, 'button')).toBe('https://example.com/base-vega/button.json')
    expect(colorsUrl(config)).toBe('https://example.com/colors/neutral.json')
  })

  it('defaults selectorRewrites to none', () => {
    expect(parseConfig(withChange({ selectorRewrites: undefined })).selectorRewrites).toEqual([])
  })

  it.each([
    ['a non-object', null, 'must be an object'],
    ['a missing upstream', withChange({ upstream: 'x' }), 'upstream must be an object'],
    [
      'a missing url',
      withChange({ upstream: { style: 'base-vega' } }),
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
      'a non-kebab style',
      withChange({ upstream: { ...valid.upstream, style: 'base/vega' } }),
      'upstream.style must be kebab-case',
    ],
    [
      'non-array rewrites',
      withChange({ selectorRewrites: {} }),
      'selectorRewrites must be an array',
    ],
    ['a non-object rewrite', withChange({ selectorRewrites: ['x'] }), 'selectorRewrites[0] must'],
    [
      'a rewrite without replace',
      withChange({ selectorRewrites: [{ pattern: 'a', reason: 'b' }] }),
      'selectorRewrites[0].replace must be a string',
    ],
    [
      'a rewrite without a pattern',
      withChange({ selectorRewrites: [{ replace: '', reason: 'b' }] }),
      'selectorRewrites[0].pattern must be',
    ],
    [
      'an invalid rewrite pattern',
      withChange({
        selectorRewrites: [{ pattern: '(', replace: '', reason: 'b' }],
      }),
      /selectorRewrites\[0\]\.pattern is not a valid regular expression: .+/,
    ],
    [
      'a rewrite without a reason',
      withChange({ selectorRewrites: [{ pattern: 'a', replace: '' }] }),
      'selectorRewrites[0].reason',
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
