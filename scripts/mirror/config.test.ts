import { describe, expect, it } from 'vitest'
import { parseConfig, upstreamUrl } from './config.ts'

const valid = {
  upstream: { url: 'https://example.com/{style}/{name}.json', style: 'base-vega' },
  components: ['button', 'icon-button'],
  snapshotDir: 'upstream',
  outputDir: 'registry/ui',
  selectorRewrites: [{ find: 'a', replace: '', reason: 'why' }],
}

function withChange(change: Record<string, unknown>) {
  return { ...valid, ...change }
}

describe('parseConfig', () => {
  it('accepts a valid config and builds item URLs', () => {
    const config = parseConfig(valid)
    expect(config).toEqual(valid)
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
      withChange({ upstream: { url: 'https://example.com', style: 'base-vega' } }),
      'must contain {style} and {name}',
    ],
    [
      'a url without {name}',
      withChange({ upstream: { url: 'https://example.com/{style}', style: 'base-vega' } }),
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
      withChange({ selectorRewrites: [{ find: 'a', reason: 'b' }] }),
      'selectorRewrites[0].replace must be a string',
    ],
    [
      'a rewrite without a reason',
      withChange({ selectorRewrites: [{ find: 'a', replace: '' }] }),
      'selectorRewrites[0].reason',
    ],
    ['a missing outputDir', withChange({ outputDir: '' }), 'outputDir must be'],
  ])('rejects %s', (_, raw, message) => {
    expect(() => parseConfig(raw)).toThrow(message)
  })
})
