import { describe, expect, it } from 'vitest'
import { compileCandidates } from './tailwind.ts'

describe('compileCandidates', () => {
  it('compiles against the shadcn theme mapping', async () => {
    const css = await compileCandidates(['bg-primary', 'rounded-md'])
    expect(css).toContain('background-color: var(--primary)')
    expect(css).toContain('border-radius: calc(var(--radius) * .8)')
  })

  it('does not carry candidates from one call into the next', async () => {
    await compileCandidates(['flex'])
    expect(await compileCandidates(['grid'])).not.toContain('display: flex')
  })
})
