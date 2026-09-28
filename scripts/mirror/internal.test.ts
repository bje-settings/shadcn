import { describe, expect, it } from 'vitest'
import { checkCollisions, internalName, renameInternal } from './internal.ts'

describe('internalName', () => {
  it('drops the tw- prefix', () => {
    expect(internalName('--tw-ring-shadow')).toBe('--ring-shadow')
  })

  it('renames a family whose bare names a component uses itself', () => {
    expect(internalName('--tw-translate-x')).toBe('--transform-translate-x')
    expect(internalName('--tw-enter-translate-x')).toBe('--enter-translate-x')
  })
})

describe('renameInternal', () => {
  it('renames every internal variable in a declaration', () => {
    expect(renameInternal('var(--tw-ring-inset,) 0 0 0 var(--tw-ring-color, currentcolor)')).toBe(
      'var(--ring-inset,) 0 0 0 var(--ring-color, currentcolor)',
    )
  })
})

describe('checkCollisions', () => {
  it('accepts disjoint names', () => {
    expect(() => checkCollisions(new Set(['--a']), new Set(['--b']))).not.toThrow()
  })

  it('refuses an internal variable another variable already names', () => {
    expect(() => checkCollisions(new Set(['--b', '--a']), new Set(['--a', '--b']))).toThrow(
      'internal custom properties collide with other variables: --a --b',
    )
  })
})
