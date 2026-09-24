import { describe, expect, it } from 'vitest'
import { type SlotOptions, slotToScss } from './scss.ts'
import { compile } from './test-support.ts'

const none: SlotOptions = {
  consumerClasses: new Map(),
  markers: new Map(),
  classProbe: () => [],
  globalClasses: new Set(['dark']),
  withoutCss: new Set(),
}

async function convert(classes: string[], options: Partial<SlotOptions> = {}) {
  return slotToScss(await compile(classes), { name: 'root', classes }, { ...none, ...options })
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

  it('keeps classes outside the module global', async () => {
    const { scss } = await convert(['dark:bg-primary'])
    expect(scss).toContain('  &:is(:global(.dark) *) {')
  })

  it('replaces group and peer markers with their selectors', async () => {
    const markers = new Map([
      ['group/card', '[data-slot="card"]'],
      ['peer', ':is([data-slot="a"], [data-slot="b"])'],
    ])
    const { scss, dropped } = await convert(
      ['group-data-[size=sm]/card:flex', 'peer-disabled:block'],
      { markers },
    )
    expect(scss).toContain('&:is(:where([data-slot="card"])[data-size="sm"] *)')
    expect(scss).toContain('&:is(:where(:is([data-slot="a"], [data-slot="b"])):disabled ~ *)')
    expect(dropped).toEqual([])
  })

  it('drops rules needing a marker no mirrored element carries', async () => {
    const { scss, dropped } = await convert(['flex', 'group-hover/card:block'])
    expect(scss).toBe(':where(.root) {\n  display: flex;\n}')
    expect(dropped).toEqual(['needs a group/card marker, which no mirrored component carries.'])
  })

  it('drops rules gated on a consumer class', async () => {
    const { scss, dropped } = await convert(['flex', '[.border-b]:pb-4'], {
      consumerClasses: new Map([['border-b', 'consumer class']]),
    })
    expect(scss).toBe(':where(.root) {\n  display: flex;\n}')
    expect(dropped).toEqual(['consumer class'])
    const own = await convert(['border-b'], {
      consumerClasses: new Map([['border-b', 'consumer class']]),
    })
    expect(own.scss).toContain('border-bottom-width: 1px;')
  })

  it('refuses other classes outside the module', async () => {
    await expect(convert(['[.border-b]:pb-4'])).rejects.toThrow(
      /references class \.border-b outside the module; list it in consumerClasses/,
    )
  })

  it('refuses classes Tailwind produces no CSS for, other than group and peer markers', async () => {
    await expect(convert(['group', 'peer/x', 'not-a-utility'])).rejects.toThrow(
      'root: Tailwind produced no CSS for not-a-utility',
    )
  })

  it('refuses a rule nested in a rule', () => {
    const css = '@layer utilities { .a { .b { color: red } } }'
    expect(() => slotToScss(css, { name: 'root', classes: ['a', 'b'] }, none)).toThrow(
      'unexpected nested rule in .b',
    )
  })

  it('keeps non-adjacent blocks with the same selector apart, in cascade order', () => {
    // Tailwind groups utilities by variant, so this order only arises from a
    // future output change; merging across the focus block would reorder it.
    const css =
      '@layer utilities { .a:hover { color: red } .b:focus { color: blue } .c:hover { color: green } }'
    expect(slotToScss(css, { name: 'root', classes: ['a', 'b', 'c'] }, none).scss).toBe(
      [
        ':where(.root) {',
        '  &:hover {',
        '    color: red;',
        '  }',
        '  &:focus {',
        '    color: blue;',
        '  }',
        '  &:hover {',
        '    color: green;',
        '  }',
        '}',
      ].join('\n'),
    )
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

  it("styles descendants at the class's specificity and the slot itself at zero", async () => {
    const { scss } = await convert(['flex', '*:w-full', '[&_svg]:size-4', 'hover:underline'])
    expect(scss).toBe(
      [
        ':where(.root) {',
        '  display: flex;',
        '  &:hover {',
        '    @media (hover: hover) {',
        '      text-decoration-line: underline;',
        '    }',
        '  }',
        '}',
        '.root {',
        '  :is(& > *) {',
        '    width: 100%;',
        '  }',
        '  & svg {',
        '    width: calc(var(--spacing) * 4);',
        '    height: calc(var(--spacing) * 4);',
        '  }',
        '}',
      ].join('\n'),
    )
  })

  it('keeps !important', async () => {
    const { scss } = await convert(['flex!'])
    expect(scss).toContain('display: flex !important;')
  })

  it('turns a class probe into the mirrored elements it finds', async () => {
    const classProbe = (fragment: string) =>
      fragment === 'size-' ? ['[data-slot="spinner"]', '[data-slot="icon"]'] : []
    const { scss } = await convert(["[&_svg:not([class*='size-'])]:size-4"], { classProbe })
    expect(scss).toContain('  & svg:where(:not([data-slot="icon"], [data-slot="spinner"])) {\n')
    // A default an icon's own size class overrides: zero specificity.
    expect(scss).toMatch(/^:where\(\.root\) \{\n {2}& svg/)
  })

  it('drops a class probe that finds nothing', async () => {
    const { scss } = await convert(["[&_svg:not([class*='size-'])]:size-4"])
    expect(scss).toContain('  & svg {\n')
  })

  it('leaves other :not() arguments alone', async () => {
    const { scss } = await convert(['[&_svg:not([data-x])]:size-4', 'not-first:flex'])
    expect(scss).toContain('  & svg:not([data-x]) {')
    expect(scss).toContain('  &:not(:first-child) {')
  })

  it('refuses a class-name selector outside :not()', async () => {
    await expect(convert(["[&_[class*='size-']]:flex"])).rejects.toThrow(
      'root: selector & [class*="size-"] matches class names outside :not()',
    )
  })

  it('reports classes with no CSS and an empty block when nothing compiles', async () => {
    expect(await convert(['group/button'])).toEqual({
      scss: ':where(.root) {\n}',
      unresolved: ['group/button'],
      customProperties: [],
      empty: true,
      dropped: [],
    })
  })

  it('lists custom properties read but not set', async () => {
    const { customProperties } = await convert(['bg-primary', 'translate-y-px'])
    expect(customProperties).toContain('--primary')
    expect(customProperties).toContain('--tw-translate-x')
    expect(customProperties).not.toContain('--tw-translate-y')
  })
})
