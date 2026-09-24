import { describe, expect, it } from 'vitest'
import { cn } from './cn.ts'

describe('cn', () => {
  it('joins truthy class names and drops falsy ones', () => {
    expect(cn('a', false, undefined, null, 'b', { c: true, d: false })).toBe('a b c')
  })

  it('flattens nested arrays', () => {
    expect(cn(['a', ['b', { c: true }]])).toBe('a b c')
  })
})
