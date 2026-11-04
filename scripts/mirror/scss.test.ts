import { describe, expect, it } from 'vitest'
import {
  CASCADE_ORDER,
  checkCascadeOrder,
  registrations,
  type SlotOptions,
  slotToScss,
} from './scss.ts'
import { compile, config, internalDefaults } from './test-support.ts'

const none: SlotOptions = {
  consumerClasses: new Map(),
  markers: new Map(),
  classProbe: () => [],
  textSized: [],
  probeRank: () => 0,
  globalClasses: new Set(['dark']),
  withoutCss: new Set(),
  internalDefaults,
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

  it('refuses a rule needing a marker no mirrored element carries', async () => {
    await expect(convert(['flex', 'group-hover/card:block'])).rejects.toThrow(
      'needs a group/card marker, which no mirrored element with a data-slot carries',
    )
  })

  it('drops a rule needing a marker no element carries when its class is listed as without CSS', async () => {
    const { scss, dropped, unresolved } = await convert(['flex', 'group-hover/card:block'], {
      withoutCss: new Set(['group-hover/card:block']),
    })
    expect(scss).toBe(':where(.root) {\n  display: flex;\n}')
    expect(dropped).toEqual([
      'group-hover/card:block matches nothing upstream either: no element carries group/card.',
    ])
    expect(unresolved).toEqual([])
  })

  it('fails on a missing marker when only another of the slot classes is without CSS', async () => {
    await expect(
      convert(['toaster', 'group-hover/card:block'], { withoutCss: new Set(['toaster']) }),
    ).rejects.toThrow('needs a group/card marker')
  })

  it('keeps a named text size slot leading off elements that set their own text size', async () => {
    const textSized = ['[data-slot="b"]']
    const { scss } = await convert(['text-sm', 'leading-relaxed'], { textSized })
    expect(scss).toContain('  &:where(:not([data-slot="b"])) {\n')
    // No named size of its own, or a leading under a variant: no gate.
    expect((await convert(['leading-relaxed'], { textSized })).scss).not.toContain(':where(:not(')
    expect((await convert(['text-sm', 'md:leading-5'], { textSized })).scss).not.toContain(
      ':where(:not(',
    )
    // No element sets a named size of its own: no gate, and no empty :not().
    expect((await convert(['text-sm', 'leading-relaxed'])).scss).not.toContain(':where(:not(')
  })

  it('inherits the line-height for a slot that resets it', async () => {
    const classes = ['flex', 'text-[0.8rem]']
    const { scss } = slotToScss(
      await compile(classes),
      { name: 'root', classes, resetsLeading: true },
      none,
    )
    expect(scss).toBe(
      ':where(.root) {\n  display: flex;\n  font-size: .8rem;\n  line-height: inherit;\n}',
    )
  })

  it('drops rules gated on a consumer class', async () => {
    const { scss, dropped } = await convert(['flex', '[.border-b]:pb-4'], {
      consumerClasses: new Map([['border-b', 'consumer class']]),
    })
    expect(scss).toBe(':where(.root) {\n  display: flex;\n}')
    expect(dropped).toEqual(['consumer class'])
    // Two classes share the reason; the slot's rules gate only on one.
    const shared = await convert(['flex', '[.border-b]:pb-4'], {
      consumerClasses: new Map([
        ['border-b', 'consumer class'],
        ['border-t', 'consumer class'],
      ]),
    })
    expect(shared.gated).toEqual(['border-b'])
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
    // The probe stays, so an icon's own class or a consumer's still excludes it, and
    // the default keeps the class's specificity as upstream's does.
    expect(scss).toContain(
      '.root {\n  & svg:not([class*="size-"], [data-slot="icon"], [data-slot="spinner"]) {\n',
    )
  })

  it('ranks class probe defaults of the same variant by Tailwind order', async () => {
    const classes = ["[&_svg:not([class*='size-'])]:size-4"]
    const { scss } = await convert(classes, {
      classProbe: () => ['[data-slot="icon"]'],
      probeRank: (candidate) => (candidate === classes[0] ? 2 : 0),
    })
    expect(scss).toContain(
      '& svg:not([class*="size-"], [data-slot="icon"]):not([class*="size-"]):not([class*="size-"]) {',
    )
  })

  it('passes whether the slot is a variant option to the rank', async () => {
    const classes = ["[&_svg:not([class*='size-'])]:size-4"]
    const seen: boolean[] = []
    const probeRank = (_: string, variant: boolean) => {
      seen.push(variant)
      return 0
    }
    const options = { ...none, classProbe: () => ['[data-slot="icon"]'], probeRank }
    await slotToScss(await compile(classes), { name: 'root', classes, variant: true }, options)
    await slotToScss(await compile(classes), { name: 'root', classes }, options)
    expect(seen).toEqual([true, false])
  })

  it('adds no rank to a selector without a probe', async () => {
    const { scss } = await convert(['flex'], { probeRank: () => 2 })
    expect(scss).toBe(':where(.root) {\n  display: flex;\n}')
  })

  it('keeps a class probe that finds nothing, and says so', async () => {
    const { scss, dropped } = await convert(["[&_svg:not([class*='size-'])]:size-4"])
    expect(scss).toContain('.root {\n  & svg:not([class*="size-"]) {\n')
    expect(dropped).toEqual([
      'upstream skips elements whose classes contain "size-", and no mirrored element does: the default skips only an element whose own class does.',
    ])
  })

  it('fails on a :not() that mixes a class probe with another selector', async () => {
    await expect(
      convert(["[&_svg:not([class*='size-'],[data-x])]:size-4"], {
        classProbe: () => ['[data-slot="icon"]'],
      }),
    ).rejects.toThrow('mixes class name probes with other selectors')
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
      scss: '',
      cascadeOrdered: [],
      unresolved: ['group/button'],
      customProperties: [],
      empty: true,
      dropped: [],
      gated: [],
      defaults: {},
      defaultSelectors: [],
      internal: [],
      external: [],
    })
  })

  it('lists custom properties read but not set', async () => {
    const { customProperties } = await convert(['bg-primary', 'translate-y-px'])
    expect(customProperties).toContain('--primary')
    // Internal variables get defaults in the module, so none is listed.
    expect(customProperties.filter((name) => name.includes('translate'))).toEqual([])
  })

  it('renames internal variables and lists their defaults and the elements using them', async () => {
    const block = await convert([
      ...['bg-primary', 'shadow-xs', 'focus-visible:ring-3', 'before:content-[""]'],
    ])
    expect(block.scss).not.toContain('--tw-')
    expect(block.scss).toContain('--shadow: 0 1px 2px 0 var(--shadow-color, #0000000d);')
    expect(block.defaults).toMatchObject({ '--shadow': '0 0 #0000', '--ring-inset': 'initial' })
    // States are the slot's own element; a pseudo-element keeps its selector.
    expect(block.defaultSelectors).toEqual([':where(.root)', ':where(.root):before'])
    expect(block.internal).toContain('--ring-shadow')
    expect(block.external).not.toContain('--ring-shadow')
    expect(block.external).toContain('--primary')
  })

  it('keeps a descendant as the element its defaults go on', async () => {
    const { defaultSelectors } = await convert(['*:shadow-xs'])
    expect(defaultSelectors).toEqual([':is(:where(.root) > *)'])
  })

  it('gives an animated slot the defaults its keyframes read', async () => {
    const { defaults } = await convert(['animate-in'])
    expect(defaults).toMatchObject({ '--enter-opacity': '1', '--enter-blur': '0' })
  })

  it('gives no default to a variable only named in transition-property', async () => {
    const { scss, defaults } = await convert(['transition-colors'])
    expect(scss).toContain('--gradient-from')
    expect(defaults).not.toHaveProperty('--gradient-from')
  })

  it('refuses an internal variable with no registration', async () => {
    await expect(convert(['shadow-xs'], { internalDefaults: new Map() })).rejects.toThrow(
      /^root: no registration for --/,
    )
  })
})

describe('the declarations of one block', () => {
  it('collapses a same-value repeat to one', async () => {
    const { scss } = await convert(['size-4', 'w-4'])
    expect(scss.match(/ width: /g)).toHaveLength(1)
    expect(scss).toContain('  height: calc(var(--spacing) * 4);')
  })

  it('keeps the later of two values', async () => {
    const { scss } = await convert(['w-auto', 'w-full'])
    expect(scss).toBe(':where(.root) {\n  width: 100%;\n}')
  })

  it('keeps an earlier !important declaration over a later plain one', async () => {
    const { scss } = await convert(['w-full', 'w-auto!'])
    expect(scss).toContain('  width: auto !important;')
    expect(scss).not.toContain('100%')
  })

  it("lets a reset line-height replace the slot's own, past a nested block", async () => {
    const classes = ['leading-none', 'hover:flex', 'text-[0.8rem]']
    const { scss } = slotToScss(
      await compile(classes),
      { name: 'root', classes, resetsLeading: true },
      none,
    )
    expect(scss.match(/line-height/g)).toEqual(['line-height'])
    expect(scss).toMatch(/\n {2}\}\n {2}line-height: inherit;\n\}$/)
  })

  it('leaves declarations in different blocks alone', async () => {
    const { scss } = await convert(['w-auto', 'hover:w-full'])
    expect(scss).toContain(':where(.root) {\n  width: auto;\n')
    expect(scss).toContain('width: 100%;')
  })

  it('puts each !important declaration in a noImportantStyles range suppression', async () => {
    const rule = "lint/complexity/noImportantStyles: upstream's ! modifier"
    const one = await convert(['flex!'])
    expect(one.scss).toBe(
      `:where(.root) {\n  // biome-ignore-start ${rule}\n  display: flex !important;\n  // biome-ignore-end ${rule}\n}`,
    )
    const two = await convert(['flex!', 'w-full!', 'hover:h-full!'])
    expect(two.scss.split(`biome-ignore-start ${rule}`)).toHaveLength(4)
    expect(two.scss.split(`biome-ignore-end ${rule}`)).toHaveLength(4)
    expect(two.scss).toContain(
      `      // biome-ignore-start ${rule}\n      height: 100% !important;\n      // biome-ignore-end ${rule}\n`,
    )
  })
})

describe('the noUnknownUnit suppressions', () => {
  const rule =
    'lint/correctness/noUnknownUnit: Biome reads a digit-led hex colour in a custom property as a number and a unit (biomejs/biome#12332)'
  const long = `0_1px_${'1px_'.repeat(22)}#0000001a`

  it('go on the line before a one-line custom property Biome misreads, and nowhere else', async () => {
    const { scss } = await convert(['[--a:#0000]', '[--b:0_1px_#0000001a]', 'text-[#0000001a]'])
    expect(scss).toBe(
      `:where(.root) {\n  color: #0000001a;\n  --a: #0000;\n  // biome-ignore ${rule}\n  --b: 0 1px #0000001a;\n}`,
    )
  })

  it('go around one the formatter spreads over lines', async () => {
    const { scss } = await convert([`[--a:${long}]`])
    expect(scss).toBe(
      `:where(.root) {\n  // biome-ignore-start ${rule}\n  --a: ${long.replaceAll('_', ' ')};\n  // biome-ignore-end ${rule}\n}`,
    )
  })

  it('sit inside the noImportantStyles range of an !important one', async () => {
    const { scss } = await convert(['[--b:0_1px_#0000001a]!'])
    expect(scss).toContain(
      `  // biome-ignore-start lint/complexity/noImportantStyles: upstream's ! modifier\n  // biome-ignore ${rule}\n  --b: 0 1px #0000001a !important;\n  // biome-ignore-end`,
    )
    const spread = (await convert([`[--a:${long}]!`])).scss
    expect(spread).toContain(
      `!important;\n  // biome-ignore-end ${rule}\n  // biome-ignore-end lint/complexity/noImportantStyles`,
    )
  })
})

describe('the root block', () => {
  it('is left out when it is empty, since Sass drops it anyway', async () => {
    const { scss, empty } = await convert(['*:w-full'])
    expect(scss).toBe('.root {\n  :is(& > *) {\n    width: 100%;\n  }\n}')
    expect(empty).toBe(false)
  })
})

describe('the noDescendingSpecificity suppressions', () => {
  const comment =
    "// biome-ignore lint/style/noDescendingSpecificity: upstream's cascade order; moving the rule would move a declaration past another"

  it('go inside the parent block, before each nested rule the table names', async () => {
    const { scss, cascadeOrdered } = await convert(['[&>svg]:size-4', 'hover:flex'], {
      cascadeOrder: [['.root', '& > svg']],
    })
    expect(scss).toContain(`.root {\n  ${comment}\n  & > svg {\n`)
    expect(scss.split(comment)).toHaveLength(2)
    expect(cascadeOrdered).toEqual([['.root', '& > svg']])
  })

  it('report no site the slot lacks', async () => {
    const { scss, cascadeOrdered } = await convert(['[&>svg]:size-4'], {
      cascadeOrder: [[':where(.root)', '& > svg']],
    })
    expect(scss).not.toContain('biome-ignore')
    expect(cascadeOrdered).toEqual([])
  })

  it('fail the build naming each site an item no longer has', () => {
    const table = { chip: [['.a', '& b'] as const, ['.c', '& d'] as const] }
    expect(() => checkCascadeOrder('chip', [['.a', '& b']], table)).toThrow(
      'scss.ts: chip has no nested rule "& d" in .c for its noDescendingSpecificity suppression',
    )
    expect(() =>
      checkCascadeOrder(
        'chip',
        [
          ['.a', '& b'],
          ['.a', '& d'],
        ],
        table,
      ),
    ).toThrow('scss.ts: chip has no nested rule "& d" in .c')
    expect(() =>
      checkCascadeOrder(
        'chip',
        [
          ['.a', '& x'],
          ['.c', '& d'],
        ],
        table,
      ),
    ).toThrow('scss.ts: chip has no nested rule "& b" in .a')
    expect(() =>
      checkCascadeOrder(
        'chip',
        [
          ['.c', '& d'],
          ['.a', '& b'],
        ],
        table,
      ),
    ).not.toThrow()
    expect(() => checkCascadeOrder('other', [])).not.toThrow()
  })

  it('name only configured components', () => {
    expect(Object.keys(CASCADE_ORDER).filter((name) => !config.components.includes(name))).toEqual(
      [],
    )
  })
})

describe('registrations', () => {
  it("maps each internal variable, renamed, to Tailwind's fallback value", () => {
    const table = registrations(
      '@layer properties { @supports (x: y) { *, ::before { --tw-a: 0px; --tw-b: initial; --other: 1 } } } @layer theme { :root { --tw-c: 1 } }',
    )
    expect([...table]).toEqual([
      ['--a', '0px'],
      ['--b', 'initial'],
    ])
  })
})
