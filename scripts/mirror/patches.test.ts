import { describe, expect, it } from 'vitest'
import { applyPatch, PATCHES, type Patches } from './patches.ts'

const patches: Patches = {
  chip: { reason: 'Chip drops its role.', transform: (s) => s.replace(' role="button"', '') },
  stale: { reason: 'Upstream fixed it.', transform: (s) => s },
  pinned: { reason: 'A consumer role wins.', tests: ['it("x", () => {})'] },
}

describe('applyPatch', () => {
  it('returns an unpatched item unchanged, with no patch', () => {
    expect(applyPatch('other', '<span />', patches)).toEqual({ source: '<span />' })
  })

  it('rewrites a patched item and returns its patch', () => {
    expect(applyPatch('chip', '<span role="button" />', patches)).toEqual({
      source: '<span />',
      patch: patches.chip,
    })
  })

  it('fails when a transform no longer changes the source, naming the item and reason', () => {
    expect(() => applyPatch('stale', '<span />', patches)).toThrow(
      'stale: its patch in scripts/mirror/patches.ts changes nothing; upstream may have absorbed it (Upstream fixed it.)',
    )
  })

  it('keeps the source of a test-only entry and returns its patch', () => {
    expect(applyPatch('pinned', '<span />', patches)).toEqual({
      source: '<span />',
      patch: patches.pinned,
    })
  })

  it('reads the shipped table by default', () => {
    expect(applyPatch('nothing-patched', 'x')).toEqual({ source: 'x' })
    expect(Object.keys(PATCHES)).toEqual(expect.any(Array))
  })
})
