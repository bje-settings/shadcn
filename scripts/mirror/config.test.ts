import { describe, expect, it } from 'vitest'
import { parseConfig, upstreamUrl } from './config.ts'

const valid = {
  namespace: 'bje',
  upstream: {
    url: 'https://example.com/{style}/{name}.json',
    style: 'base-vega',
  },
  components: ['button', 'icon-button'],
  snapshotDir: 'upstream',
  outputDir: 'registry/ui',
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
      withChange({
        upstream: { url: 'https://example.com', style: 'base-vega' },
      }),
      'must contain {style} and {name}',
    ],
    [
      'a url without {name}',
      withChange({
        upstream: { url: 'https://example.com/{style}', style: 'base-vega' },
      }),
      'must contain {style} and {name}',
    ],
    ['non-array components', withChange({ components: 'button' }), 'components must be'],
    ['empty components', withChange({ components: [] }), 'components must be'],
    ['non-kebab components', withChange({ components: ['Button'] }), 'components must be'],
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
      'selectorRewrites[0].pattern is not a valid regular expression',
    ],
    [
      'a rewrite without a reason',
      withChange({ selectorRewrites: [{ pattern: 'a', replace: '' }] }),
      'selectorRewrites[0].reason',
    ],
    ['a missing namespace', withChange({ namespace: '' }), 'namespace must be'],
    ['a missing outputDir', withChange({ outputDir: '' }), 'outputDir must be'],
  ])('rejects %s', (_, raw, message) => {
    expect(() => parseConfig(raw)).toThrow(message)
  })
})
