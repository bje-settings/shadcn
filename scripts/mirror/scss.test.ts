import { describe, expect, it } from 'vitest'
import { slotToScss } from './scss.ts'
import { compileCandidates } from './tailwind.ts'

async function convert(
  classes: string[],
  rewrites = [] as { find: string; replace: string; reason: string }[],
) {
  return slotToScss(await compileCandidates(classes), { name: 'root', classes }, rewrites)
}

describe('slotToScss', () => {
  it('nests utilities under a zero-specificity module class', async () => {
    const { scss, unresolved } = await convert(['flex', 'items-center'])
    expect(scss).toBe(':where(.root) {\n  display: flex;\n  align-items: center;\n}')
    expect(unresolved).toEqual([])
  })

  it('turns variants into nested selectors and wrapper at-rules', async () => {
    const { scss } = await convert(['hover:bg-primary/80', 'in-data-[slot=group]:rounded-md'])
    expect(scss).toContain(
      '  &:hover {\n    @media (hover: hover) {\n      background-color: var(--primary);',
    )
    expect(scss).toContain('    @supports (color: color-mix(in lab, red, red)) {')
    expect(scss).toContain('  :where([data-slot="group"]) & {')
  })

  it('merges adjacent blocks that share a selector', async () => {
    const { scss } = await convert(['disabled:opacity-50', 'disabled:pointer-events-none'])
    expect(scss.match(/&:disabled/g)).toHaveLength(1)
  })

  it('keeps each rule a variant expands to', async () => {
    const { scss } = await convert(['selection:bg-primary'])
    expect(scss).toContain('  & ::selection {')
    expect(scss).toContain('  &::selection {')
  })

  it('keeps !important', async () => {
    const { scss } = await convert(['flex!'])
    expect(scss).toContain('display: flex !important;')
  })

  it('applies selector rewrites', async () => {
    const { scss } = await convert(
      ["[&_svg:not([class*='size-'])]:size-4"],
      [{ find: ':not([class*="size-"])', replace: '', reason: 'test' }],
    )
    expect(scss).toContain('  & svg {\n')
  })

  it('reports classes with no CSS and an empty block when nothing compiles', async () => {
    expect(await convert(['group/button'])).toEqual({
      scss: ':where(.root) {\n}',
      unresolved: ['group/button'],
      customProperties: [],
    })
  })

  it('lists custom properties read but not set', async () => {
    const { customProperties } = await convert(['bg-primary', 'translate-y-px'])
    expect(customProperties).toContain('--primary')
    expect(customProperties).toContain('--tw-translate-x')
    expect(customProperties).not.toContain('--tw-translate-y')
  })
})
