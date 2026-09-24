import { describe, expect, it } from 'vitest'
import { cn } from './utils.ts'

describe('cn', () => {
  it('joins truthy class names and drops falsy ones', () => {
    expect(cn('a', false, undefined, null, 'b', { c: true, d: false })).toBe('a b c')
  })

  it('resolves conflicting Tailwind classes in favor of the last one', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4')
  })
})
