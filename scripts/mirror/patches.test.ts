import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Node } from '@babel/types'
import { describe, expect, it } from 'vitest'
import { parseModule } from './ast.ts'
import {
  applyPatch,
  calendarComponents,
  dropAttributes,
  forwardThumbLabels,
  PATCHES,
  type Patches,
  suppress,
} from './patches.ts'
import { config, root } from './test-support.ts'

// Upstream's luma source for an item, as snapshotted.
const luma = (name: string): string =>
  JSON.parse(readFileSync(join(root, 'upstream/base-luma', `${name}.json`), 'utf8')).files[0]
    .content

const patches: Patches = {
  chip: { reason: 'Chip drops its role.', transform: (s) => s.replace(' role="button"', '') },
  stale: { reason: 'Upstream fixed it.', transform: (s) => s },
  broken: {
    reason: 'Upstream moved it.',
    transform: () => {
      throw new Error("patches.ts: upstream's source has no chip")
    },
  },
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

  it('names the item when its transform fails, and keeps the original error', () => {
    expect(() => applyPatch('broken', '<span />', patches)).toThrow(
      "broken: its patch in scripts/mirror/patches.ts failed: patches.ts: upstream's source has no chip",
    )
    expect(() => applyPatch('broken', '<span />', patches)).toThrow(
      expect.objectContaining({
        cause: new Error("patches.ts: upstream's source has no chip"),
      }),
    )
  })

  it('keeps the source of a test-only entry and returns its patch', () => {
    expect(applyPatch('pinned', '<span />', patches)).toEqual({
      source: '<span />',
      patch: patches.pinned,
    })
  })

  it('patches only configured components', () => {
    expect(Object.keys(PATCHES).filter((name) => !config.components.includes(name))).toEqual([])
  })

  it('reads the shipped table by default', () => {
    expect(applyPatch('nothing-patched', 'x')).toEqual({ source: 'x' })
    expect(applyPatch('alert', 'x')).toEqual({ source: 'x', patch: PATCHES.alert })
  })
})

describe('dropAttributes', () => {
  it('drops each named attribute wherever it sits on the element', () => {
    expect(
      dropAttributes('<span role="x" data-slot="s" {...p} aria-disabled="true" />', 's', [
        'role',
        'aria-disabled',
      ]),
    ).toBe('<span data-slot="s" {...p} />')
  })

  it.each([
    ['single element with data-slot="s"', '<b data-slot="t" role="x" />'],
    ['single element with data-slot="s"', '<b><i data-slot="s" role="x" /><i data-slot="s" /></b>'],
    ['role on s', '<b data-slot="s" />'],
  ])('fails on a source with no %s', (what, code) => {
    expect(() => dropAttributes(code, 's', ['role'])).toThrow(
      `patches.ts: upstream's source has no ${what}`,
    )
  })
})

describe('the breadcrumb patch', () => {
  const source = luma('breadcrumb')
  const page = (code: string) =>
    code.slice(
      code.indexOf('function BreadcrumbPage'),
      code.indexOf('function BreadcrumbSeparator'),
    )

  it("drops BreadcrumbPage's link role and aria-disabled, and keeps aria-current", () => {
    expect(page(source)).toContain('role="link"')
    const { source: patched } = applyPatch('breadcrumb', source)
    expect(page(patched)).not.toContain('role=')
    expect(page(patched)).not.toContain('aria-disabled')
    expect(page(patched)).toContain('aria-current="page"')
  })

  it('leaves every other element as upstream wrote it', () => {
    const { source: patched } = applyPatch('breadcrumb', source)
    expect(patched.replace(page(patched), '')).toBe(source.replace(page(source), ''))
    expect(patched).toContain('role="presentation"')
  })

  it('fails the build, naming what is gone, once upstream drops an attribute itself', () => {
    const absorbed = dropAttributes(source, 'breadcrumb-page', ['aria-disabled'])
    expect(() => applyPatch('breadcrumb', absorbed)).toThrow(
      "breadcrumb: its patch in scripts/mirror/patches.ts failed: patches.ts: upstream's source has no aria-disabled on breadcrumb-page",
    )
  })
})

describe('the slider patch', () => {
  const source = luma('slider')

  it('takes getAriaLabel and getAriaValueText, typed from the Thumb, and passes them to it', () => {
    const { source: patched } = applyPatch('slider', source)
    parseModule(patched)
    expect(patched).toContain('max = 100,\n  getAriaLabel, getAriaValueText, ...props\n')
    expect(patched).toContain(
      "}: SliderPrimitive.Root.Props & Pick<SliderPrimitive.Thumb.Props, 'getAriaLabel' | 'getAriaValueText'>) {",
    )
    expect(patched).toContain(
      '<SliderPrimitive.Thumb getAriaLabel={getAriaLabel} getAriaValueText={getAriaValueText}\n',
    )
  })

  it('fails the build once upstream forwards them itself', () => {
    expect(() => applyPatch('slider', forwardThumbLabels(source))).toThrow(
      'slider: its patch in scripts/mirror/patches.ts changes nothing',
    )
  })

  it('fails when upstream forwards only one of them', () => {
    const one = source.replace(
      '<SliderPrimitive.Thumb',
      '<SliderPrimitive.Thumb getAriaValueText={f}',
    )
    expect(one).not.toBe(source)
    expect(() => forwardThumbLabels(one)).toThrow(
      "patches.ts: upstream's Slider Thumb forwards only getAriaValueText",
    )
  })

  it.each([
    ['Slider Thumb element', 'function Slider({ ...props }: P) { return <Root /> }'],
    ['Slider function', 'export default function ({ ...props }: P) { return <S.Thumb /> }'],
    ['Slider props pattern', 'function Slider() { return <S.Thumb /> }'],
    ['Slider props pattern', 'function Slider(props: P) { return <S.Thumb /> }'],
    ['rest element in the Slider props', 'function Slider({ a }: P) { return <S.Thumb /> }'],
    ['Slider props type', 'function Slider({ ...props }) { return <S.Thumb /> }'],
  ])('fails on a source with no %s', (what, code) => {
    expect(() => forwardThumbLabels(code)).toThrow(`patches.ts: upstream's source has no ${what}`)
  })
})

describe('suppress', () => {
  const rule = 'lint/x/y'
  const named =
    (type: string, what = type) =>
    (all: Node[]): [string, Node | undefined][] => [[what, all.find((n) => n.type === type)]]

  it('puts a line comment before an object property, at its indentation', () => {
    expect(suppress('const a = {\n  b: 1,\n}\n', rule, 'why', named('ObjectProperty'))).toBe(
      'const a = {\n  // biome-ignore lint/x/y: why\n  b: 1,\n}\n',
    )
  })

  it('puts a JSX comment before an element among JSX children', () => {
    const code = '<a>\n  <b />\n</a>'
    const b = (all: Node[]): [string, Node | undefined][] => [
      ['b', all.filter((n) => n.type === 'JSXElement')[1]],
    ]
    expect(suppress(code, rule, 'why', b)).toBe(
      '<a>\n  {/* biome-ignore lint/x/y: why */}\n  <b />\n</a>',
    )
    expect(suppress('<>\n  <b />\n</>', rule, 'why', named('JSXElement'))).toBe(
      '<>\n  {/* biome-ignore lint/x/y: why */}\n  <b />\n</>',
    )
  })

  it('puts a line comment before an element that is not a JSX child', () => {
    expect(suppress('() => (\n  <b />\n)', rule, 'why', named('JSXElement'))).toBe(
      '() => (\n  // biome-ignore lint/x/y: why\n  <b />\n)',
    )
  })

  it('fails by name when a site is gone', () => {
    expect(() => suppress('const a = 1\n', rule, 'why', named('ObjectProperty', 'b'))).toThrow(
      "patches.ts: upstream's source has no b",
    )
  })

  it('fails by name when a site shares its line with other code', () => {
    expect(() =>
      suppress('const a = { b: 1 }\n', rule, 'why', named('ObjectProperty', 'b')),
    ).toThrow('patches.ts: b does not start its line')
  })

  it('leaves the source unchanged when it names no site', () => {
    expect(suppress('const a = 1\n', rule, 'why', () => [])).toBe('const a = 1\n')
  })
})

describe('the calendar patch', () => {
  const source = luma('calendar')
  const comment = '// biome-ignore lint/correctness/noComponentHookFactories: '

  it("puts a noComponentHookFactories suppression before each of DayPicker's inline components", () => {
    const { source: patched } = applyPatch('calendar', source)
    parseModule(patched)
    for (const name of ['Root', 'Chevron', 'DayButton', 'WeekNumber']) {
      expect(patched).toMatch(new RegExp(`\\n( +)${comment}[^\\n]+\\n\\1${name}: `))
    }
    expect(patched.split(comment)).toHaveLength(5)
  })

  it('fails the build naming a component upstream no longer writes inline', () => {
    const without = source.replace(/\n {8}WeekNumber: /, '\n        Other: ')
    expect(without).not.toBe(source)
    expect(() => applyPatch('calendar', without)).toThrow(
      "calendar: its patch in scripts/mirror/patches.ts failed: patches.ts: upstream's source has no inline WeekNumber in DayPicker's components",
    )
  })

  it.each([
    ['Calendar function', 'function Other() { return <DayPicker components={{}} /> }'],
    ['DayPicker element in Calendar', 'function Calendar() { return <Other components={{}} /> }'],
    [
      'DayPicker element in Calendar',
      'function Other() { return <DayPicker components={{}} /> }\nfunction Calendar() { return <div /> }',
    ],
    ['components object on DayPicker', 'function Calendar() { return <DayPicker /> }'],
    [
      'components object on DayPicker',
      'function Calendar() { return <DayPicker components={c} /> }',
    ],
    [
      'components object on DayPicker',
      'function Calendar() { return <DayPicker components="c" /> }',
    ],
  ])('fails on a source with no %s', (what, code) => {
    expect(() => suppress(code, 'lint/x/y', 'why', calendarComponents)).toThrow(
      `patches.ts: upstream's source has no ${what}`,
    )
  })

  it.each([
    ['a spread', '...c'],
    ['a string-keyed computed property', '["Root"]: () => null'],
    ['an identifier-keyed computed property', '[Root]: () => null'],
    ['a hoisted component', 'Root: CalendarRoot'],
    ['a component read from an object', 'Root: Parts.Root'],
    ['a method', 'Root() { return null }'],
  ])('does not take %s for an inline component', (_, property) => {
    const code = `function Calendar() {\n  return <DayPicker components={{\n    ${property},\n  }} />\n}`
    expect(() => suppress(code, 'lint/x/y', 'why', calendarComponents)).toThrow(
      "patches.ts: upstream's source has no inline Root in DayPicker's components",
    )
  })

  it('takes a function expression for an inline component', () => {
    const code = [
      'function Calendar() {',
      '  return <DayPicker components={{',
      '    Root: function () { return null },',
      '    Chevron: () => null,',
      '    DayButton: () => null,',
      '    WeekNumber: () => null,',
      '  }} />',
      '}',
    ].join('\n')
    expect(suppress(code, 'lint/x/y', 'why', calendarComponents)).toContain(
      '    // biome-ignore lint/x/y: why\n    Root: function',
    )
  })
})
