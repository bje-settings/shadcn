import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Node } from '@babel/types'
import { describe, expect, it } from 'vitest'
import { parseModule } from './ast.ts'
import {
  applyPatch,
  calendarComponents,
  cookieWrite,
  dropAttributes,
  forwardThumbLabels,
  hookDependencies,
  indexKeys,
  PATCHES,
  type Patches,
  returnedElement,
  roles,
  type Sites,
  slotElement,
  suppress,
  tagAttribute,
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

  it('fails by name when a site follows other code and nothing on its line starts it', () => {
    const second = (all: Node[]): Sites => [
      ['b', all.filter((n) => n.type === 'ObjectProperty')[1]],
    ]
    expect(() => suppress('const a = {\n  c: 2, b: 1,\n}\n', rule, 'why', second)).toThrow(
      'patches.ts: b does not start its line',
    )
  })

  it('suppresses a site after other code on its line from the ancestor that starts the line', () => {
    expect(suppress('const a = { b: 1 }\n', rule, 'why', named('ObjectProperty'))).toBe(
      '// biome-ignore lint/x/y: why\nconst a = { b: 1 }\n',
    )
    const code = 'xs.map(\n  (x, i) =>\n    x && <li key={i} />,\n)\n'
    expect(suppress(code, rule, 'why', named('JSXAttribute'))).toBe(
      'xs.map(\n  (x, i) =>\n    // biome-ignore lint/x/y: why\n    x && <li key={i} />,\n)\n',
    )
  })

  it('puts a line comment before an attribute in an opening tag', () => {
    expect(suppress('<a\n  b="1"\n/>', rule, 'why', named('JSXAttribute'))).toBe(
      '<a\n  // biome-ignore lint/x/y: why\n  b="1"\n/>',
    )
  })

  it('takes an opening element for its element, among children or returned', () => {
    const inner = (all: Node[]): Sites => [
      ['b', all.filter((n) => n.type === 'JSXOpeningElement')[1]],
    ]
    expect(suppress('<a>\n  <b c="1" />\n</a>', rule, 'why', inner)).toBe(
      '<a>\n  {/* biome-ignore lint/x/y: why */}\n  <b c="1" />\n</a>',
    )
    expect(suppress('() => (\n  <b />\n)', rule, 'why', named('JSXOpeningElement'))).toBe(
      '() => (\n  // biome-ignore lint/x/y: why\n  <b />\n)',
    )
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

// Each entry's suppressions on luma's source: the rule, and the line after
// each comment, in order.
describe.each([
  ['button-group', [['lint/a11y/useSemanticElements', '<div']]],
  [
    'carousel',
    [
      ['lint/a11y/useSemanticElements', '<div'],
      ['lint/a11y/useSemanticElements', '<div'],
    ],
  ],
  [
    'field',
    [
      ['lint/a11y/useSemanticElements', '<div'],
      ['lint/suspicious/noArrayIndexKey', 'error?.message && <li key={index}>{error.message}</li>'],
    ],
  ],
  [
    'input-group',
    [
      ['lint/a11y/useSemanticElements', '<div'],
      ['lint/a11y/useSemanticElements', '// biome-ignore lint/a11y/useKeyWithClickEvents: '],
      ['lint/a11y/useKeyWithClickEvents', '<div'],
    ],
  ],
  ['input-otp', [['lint/a11y/useSemanticElements', '<div']]],
  ['item', [['lint/a11y/useSemanticElements', '<div']]],
  [
    'chart',
    [
      ['lint/security/noDangerouslySetInnerHtml', 'dangerouslySetInnerHTML={{'],
      ['lint/suspicious/noArrayIndexKey', 'key={index}'],
      ['lint/suspicious/noArrayIndexKey', 'key={index}'],
    ],
  ],
  ['slider', [['lint/suspicious/noArrayIndexKey', 'key={index}']]],
  [
    'sidebar',
    [
      ['lint/suspicious/noDocumentCookie', 'document.cookie = '],
      ['lint/correctness/useExhaustiveDependencies', 'const toggleSidebar = React.useCallback('],
      ['lint/correctness/useExhaustiveDependencies', 'const contextValue = React.useMemo'],
    ],
  ],
  ['label', [['lint/a11y/noLabelWithoutControl', 'return (']]],
] as const)('the %s patch', (name, expected) => {
  const source = luma(name)

  it('puts each suppression on its own line before its site, in the form the position takes', () => {
    const { source: patched } = applyPatch(name, source)
    parseModule(patched)
    const lines = patched.split('\n')
    const sites = lines.flatMap((line, i) => {
      const match = /^(\s*)(\/\/|\{\/\*) biome-ignore (\S+): /.exec(line)
      if (!match) return []
      const next = lines[i + 1] as string
      // A JSX comment sits among children, a line comment anywhere else.
      expect(match[2] === '{/*').toBe(line.endsWith(' */}'))
      expect(next.startsWith(match[1] as string)).toBe(true)
      return [[match[3], next.trim()]]
    })
    expect(sites.map(([rule]) => rule)).toEqual(expected.map(([rule]) => rule))
    sites.forEach(([, next], i) => {
      expect(next?.startsWith((expected[i] as readonly string[])[1] as string)).toBe(true)
    })
  })

  it('names the rules it suppresses in its reason', () => {
    for (const [rule] of expected) {
      expect(PATCHES[name]?.reason).toMatch(
        new RegExp(`^[^.]*Biome's [^.]*\\b${rule.split('/').at(-1)}\\b`),
      )
    }
  })
})

describe('a suppression whose site upstream dropped', () => {
  it.each([
    [
      'button-group',
      ['role="group"\n      data-slot="button-group"', 'data-slot="button-group"'],
      'element with data-slot="button-group" and role="group"',
    ],
    [
      'carousel',
      ['data-slot="carousel-item"', 'data-slot="slide"'],
      'element with data-slot="carousel-item" and role="group"',
    ],
    [
      'field',
      ['<li key={index}>', '<li key={error.message}>'],
      "key from a callback's index in FieldError",
    ],
    [
      'input-group',
      ['role="group"\n      data-slot="input-group-addon"', 'data-slot="input-group-addon"'],
      'element with data-slot="input-group-addon" and role="group"',
    ],
    [
      'input-otp',
      ['role="separator"', 'role="presentation"'],
      'element with data-slot="input-otp-separator" and role="separator"',
    ],
    [
      'item',
      ['role="list"', 'role="group"'],
      'element with data-slot="item-group" and role="list"',
    ],
    [
      'chart',
      ['dangerouslySetInnerHTML', 'data-css'],
      'dangerouslySetInnerHTML on a style element',
    ],
    [
      'chart',
      ['key={index}', 'key={item.dataKey}'],
      "key from a callback's index in ChartLegendContent",
    ],
    ['slider', ['key={index}', 'key={String(index)}'], "key from a callback's index in Slider"],
    [
      'sidebar',
      ['[isMobile, setOpen, setOpenMobile]', '[isMobile, setOpen]'],
      'toggleSidebar = React.useCallback(...) listing setOpenMobile in SidebarProvider',
    ],
    [
      'sidebar',
      ['document.cookie =', 'window.name ='],
      'document.cookie assignment in SidebarProvider',
    ],
    ['label', ['<label', '<span'], 'return of a label element in Label'],
  ])('fails the %s build naming it', (name, [from, to], what) => {
    const source = luma(name as string)
    // The last occurrence: the legend's key comes after the tooltip's.
    const at = source.lastIndexOf(from as string)
    const changed = source.slice(0, at) + to + source.slice(at + (from as string).length)
    expect(changed).not.toBe(source)
    expect(() => applyPatch(name as string, changed)).toThrow(
      `${name}: its patch in scripts/mirror/patches.ts failed: patches.ts: upstream's source has no ${what}`,
    )
  })
})

describe('the locators', () => {
  const sites = (locate: (all: Node[]) => Sites, code: string) =>
    locate(nodes(code)).map(([what, node]) => [what, node?.type])
  const nodes = (code: string): Node[] => {
    const all: Node[] = []
    suppress(code, 'lint/x/y', 'why', (found) => {
      all.push(...found)
      return []
    })
    return all
  }

  it.each([
    ['no element', '<b />'],
    ['two elements', '<a><b data-slot="s" role="group" /><b data-slot="s" role="group" /></a>'],
    ['no role', '<b data-slot="s" />'],
    ['a role set by expression', '<b data-slot="s" role={r} />'],
    ['another role', '<b data-slot="s" role="list" />'],
  ])('roles finds no site on %s', (_, code) => {
    expect(sites(roles({ s: 'group' }), code)).toEqual([
      ['element with data-slot="s" and role="group"', undefined],
    ])
  })

  it('roles takes the element carrying the slot and the role', () => {
    expect(sites(roles({ s: 'group' }), '<b data-slot="s" role="group" />')).toEqual([
      ['element with data-slot="s" and role="group"', 'JSXOpeningElement'],
    ])
  })

  it('slotElement takes the one element with the slot, and nothing for none or two', () => {
    expect(sites(slotElement('s'), '<b data-slot="s" />')).toEqual([
      ['element with data-slot="s"', 'JSXOpeningElement'],
    ])
    expect(sites(slotElement('s'), '<b />')).toEqual([['element with data-slot="s"', undefined]])
    expect(sites(slotElement('s'), '<a><b data-slot="s" /><b data-slot="s" /></a>')).toEqual([
      ['element with data-slot="s"', undefined],
    ])
  })

  it.each([
    ['a function declaration', 'function F() { return xs.map((x, i) => <b key={i} />) }'],
    ['a const', 'const F = () => xs.map(function (x, i) { return <b key={i} /> })'],
  ])('indexKeys takes the key from the index in %s', (_, code) => {
    expect(sites(indexKeys('F'), code)).toEqual([
      ["key from a callback's index in F", 'JSXAttribute'],
    ])
  })

  it.each([
    ['no such function', 'function G() { return xs.map((x, i) => <b key={i} />) }'],
    ['a destructured const', 'const [F] = [() => xs.map((x, i) => <b key={i} />)]'],
    ['a callback passed by name', 'function F() { return xs.map(f) }'],
    ['a callback with no index', 'function F() { return xs.map((x) => <b key={x} />) }'],
    ['a destructured index', 'function F() { return xs.map((x, { i }) => <b key={i} />) }'],
    ['a key from the item', 'function F() { return xs.map((x, i) => <b key={x} />) }'],
    ['a key from a member', 'function F() { return xs.map((x, i) => <b key={x.i} />) }'],
    ['a string key', 'function F() { return xs.map((x, i) => <b key="i" />) }'],
    ['a key with no value', 'function F() { return xs.map((x, i) => <b key />) }'],
    ['another attribute', 'function F() { return xs.map((x, i) => <b id={i} />) }'],
    [
      'two index keys',
      'function F() { return [xs.map((x, i) => <b key={i} />), ys.map((y, j) => <b key={j} />)] }',
    ],
  ])('indexKeys finds no site with %s', (_, code) => {
    expect(sites(indexKeys('F'), code)).toEqual([["key from a callback's index in F", undefined]])
  })

  it('tagAttribute takes the one attribute on that tag, and nothing for none or two', () => {
    const at = tagAttribute('style', 'x')
    expect(sites(at, '<a><style x="1" /><style /><b.style x="2" /></a>')).toEqual([
      ['x on a style element', 'JSXAttribute'],
    ])
    expect(sites(at, '<a><style /><b x="1" /></a>')).toEqual([['x on a style element', undefined]])
    expect(sites(at, '<a><style x="1" /><style x="2" /></a>')).toEqual([
      ['x on a style element', undefined],
    ])
  })

  const hooks = hookDependencies('F', 'set', { value: 'useMemo' })
  const what = 'value = React.useMemo(...) listing set in F'

  it('hookDependencies takes the const whose hook lists the dependency', () => {
    expect(sites(hooks, 'function F() { const value = React.useMemo(() => 1, [a, set]) }')).toEqual(
      [[what, 'VariableDeclaration']],
    )
  })

  it.each([
    ['two declarators', 'const value = React.useMemo(() => 1, [set]), b = 1'],
    ['a destructured const', 'const [value] = React.useMemo(() => 1, [set])'],
    ['another name', 'const other = React.useMemo(() => 1, [set])'],
    ['no call', 'const value = set'],
    ['a bare hook', 'const value = useMemo(() => 1, [set])'],
    ['a computed hook', 'const value = React[useMemo](() => 1, [set])'],
    ['another object', 'const value = Hooks.useMemo(() => 1, [set])'],
    ['another hook', 'const value = React.useCallback(() => 1, [set])'],
    ['no dependency array', 'const value = React.useMemo(() => 1, deps)'],
    ['no dependency', 'const value = React.useMemo(() => 1, [, a])'],
    ['an uninitialised const', 'let value'],
    ['a statement', 'value()'],
  ])('hookDependencies finds no site with %s', (_, statement) => {
    expect(sites(hooks, `function F() { ${statement} }`)).toEqual([[what, undefined]])
  })

  it('cookieWrite takes the statement assigning document.cookie', () => {
    expect(sites(cookieWrite('F'), 'function F() { document.cookie = "a" }')).toEqual([
      ['document.cookie assignment in F', 'ExpressionStatement'],
    ])
  })

  it.each([
    ['a call', 'document.cookie()'],
    ['a plain assignment', 'cookie = "a"'],
    ['a computed object', 'globals[0].cookie = "a"'],
    ['another object', 'window.cookie = "a"'],
    ['a computed property', 'document[cookie] = "a"'],
    ['another property', 'document.title = "a"'],
  ])('cookieWrite finds no site in %s', (_, statement) => {
    expect(sites(cookieWrite('F'), `function F() { ${statement} }`)).toEqual([
      ['document.cookie assignment in F', undefined],
    ])
  })

  it('returnedElement takes the return of the tag', () => {
    expect(sites(returnedElement('F', 'label'), 'function F() { return <label /> }')).toEqual([
      ['return of a label element in F', 'ReturnStatement'],
    ])
  })

  it.each([
    ['a bare return', 'return'],
    ['a returned value', 'return null'],
    ['another tag', 'return <span />'],
    ['a member tag', 'return <a.label />'],
  ])('returnedElement finds no site with %s', (_, statement) => {
    expect(sites(returnedElement('F', 'label'), `function F() { ${statement} }`)).toEqual([
      ['return of a label element in F', undefined],
    ])
  })

  it.each([
    ['hookDependencies', hookDependencies('F', 'set', {})],
    ['cookieWrite', cookieWrite('F')],
    ['returnedElement', returnedElement('F', 'label')],
  ])('%s fails by name without the function', (_, locate) => {
    expect(() => locate(nodes('function G() {}'))).toThrow(
      "patches.ts: upstream's source has no F function",
    )
  })
})
