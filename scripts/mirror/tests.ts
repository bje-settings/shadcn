// Generates the test file shipped with each component. Upstream publishes no
// tests, so they are derived from what the transform learned: each exported
// component's data-slot, its own module class, the cva() variant groups it
// applies and its literal prop defaults, rendered in the scaffold its docs
// example gives it (parts.ts), plus its exported hooks and re-exported values
// (docs/mirror-pipeline.md, Generated tests). Assertions go through the
// `styles` import, so they hold whatever class names the consumer's CSS module
// setup produces.

import type { Node } from '@babel/types'
import { parseModule } from './ast.ts'
import type { TestSetup } from './config.ts'
import { camelCase, pascalCase } from './names.ts'
import type { ItemParts, Literal, Part, PartTypes, Scaffold, Usage } from './parts.ts'
import type { Hook, RenderedComponent, TransformedComponent, VariantSet } from './tsx.ts'

// The values a module exports by name; types are not tested.
export function exportedNames(code: string): Set<string> {
  const ast = parseModule(code)
  const names = new Set<string>()
  for (const statement of ast.program.body) {
    if (statement.type !== 'ExportNamedDeclaration' || statement.exportKind === 'type') continue
    for (const specifier of statement.specifiers) {
      if (
        specifier.type === 'ExportSpecifier' &&
        specifier.exportKind !== 'type' &&
        specifier.exported.type === 'Identifier'
      ) {
        names.add(specifier.exported.name)
      }
    }
    if (statement.declaration?.type === 'FunctionDeclaration' && statement.declaration.id) {
      names.add(statement.declaration.id.name)
    }
  }
  return names
}

// Values a module passes on from a package unchanged, and how a test reaches
// the original: `export { DirectionProvider } from "@base-ui/react/direction-
// provider"`, or an exported `const Select = SelectPrimitive.Root`.
type Forwarded = { name: string; original: string; from: string; importLine: string }

function forwardedValues(code: string, exported: Set<string>): Forwarded[] {
  const { body } = parseModule(code).program
  const imports = new Map(
    body.flatMap((statement) =>
      statement.type === 'ImportDeclaration'
        ? statement.specifiers.map(
            (s) => [s.local.name, { specifier: s, from: statement.source.value }] as const,
          )
        : [],
    ),
  )
  return body.flatMap((statement): Forwarded[] => {
    if (statement.type === 'ExportNamedDeclaration' && statement.source) {
      if (statement.exportKind === 'type') return []
      const from = statement.source.value
      const namespace = camelCase(from.split('/').at(-1) as string)
      return statement.specifiers.flatMap((specifier) =>
        specifier.type === 'ExportSpecifier' &&
        specifier.exportKind !== 'type' &&
        specifier.exported.type === 'Identifier'
          ? [
              {
                name: specifier.exported.name,
                original: `${namespace}.${specifier.local.name}`,
                from,
                importLine: `import * as ${namespace} from ${moduleString(from)}`,
              },
            ]
          : [],
      )
    }
    if (statement.type !== 'VariableDeclaration') return []
    return statement.declarations.flatMap((declarator) => {
      const { id, init } = declarator
      let root: Node | null | undefined = init
      while (root?.type === 'MemberExpression') root = root.object
      const source = root?.type === 'Identifier' ? imports.get(root.name) : undefined
      if (id.type !== 'Identifier' || !exported.has(id.name) || !source || !init) return []
      const { specifier, from } = source
      const local = specifier.local.name
      const head =
        specifier.type === 'ImportSpecifier'
          ? `{ ${specifier.imported.type === 'Identifier' ? specifier.imported.name : q(specifier.imported.value)} as ${local} }`
          : specifier.type === 'ImportNamespaceSpecifier'
            ? `* as ${local}`
            : local
      return [
        {
          name: id.name,
          original: code.slice(init.start as number, init.end as number),
          from,
          importLine: `import ${head} from ${moduleString(from)}`,
        },
      ]
    })
  })
}

// A module specifier from upstream's imports, as a string literal: only a
// package path (`@base-ui/react/select`), kept readable.
function moduleString(from: string): string {
  if (!/^[@\w][\w@./-]*$/.test(from)) throw new Error(`unexpected module specifier ${from}`)
  return `"${from}"`
}

// String literals and JSON values for generated code. Upstream text (an
// error message, an image URL) goes into the test source, so beyond JSON's
// escaping they escape what could end a surrounding context: angle brackets,
// the slash of `</script>`, and the JS line separators.
const UNSAFE: Record<string, string> = {
  '<': '\\u003C',
  '>': '\\u003E',
  '/': '\\u002F',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
}

// Any JSON value as a JavaScript expression, escaped the same way.
const jsValue = (value: Literal) =>
  JSON.stringify(value).replace(/[<>/\u2028\u2029]/g, (char) => UNSAFE[char] as string)

const q = (value: string) => jsValue(value)

function defaultClasses(set: VariantSet): string[] {
  return [
    `styles.${set.base}`,
    ...set.groups.flatMap((group) => {
      const option = group.options.find((o) => o.value === group.default)
      return option?.slot ? [`styles.${option.slot}`] : []
    }),
  ]
}

// Literal props, then props as TypeScript expressions (a Date), then a rest.
function objectLiteral(
  props: Record<string, Literal>,
  rest?: string,
  code: Record<string, string> = {},
): string {
  const entries = [
    ...Object.entries(props).map(([name, value]) => `${q(name)}: ${jsValue(value)}`),
    ...Object.entries(code).map(([name, expression]) => `${q(name)}: ${expression}`),
  ]
  return `{ ${[...entries, ...(rest ? [`...${rest}`] : [])].join(', ')} }`
}

// A component's JSX attributes for literal props. When the example leaves
// out a prop the component's type requires (Progress's value is not a
// literal there), they go in as one spread cast to its props, which the
// component renders without.
type Attributes = (component: string, props: Record<string, Literal>) => string

function attributesFor(types: Map<string, PartTypes>): Attributes {
  return (component, props) => {
    const required = types.get(component)?.required ?? []
    if (required.some((prop) => prop !== 'children' && !(prop in props))) {
      return ` {...(${objectLiteral(props)} as ComponentProps<typeof ${component}>)}`
    }
    return Object.entries(props)
      .map(([name, value]) => {
        if (value === true) return ` ${name}`
        // A JSX attribute string takes no escapes: an escaped one goes in braces.
        const plain = typeof value === 'string' && q(value) === JSON.stringify(value)
        return ` ${name}=${plain ? q(value as string) : `{${jsValue(value)}}`}`
      })
      .join('')
  }
}

// `inner` rendered inside the scaffold's ancestors.
function scaffolded(ancestors: Part[], inner: string, attributes: Attributes): string {
  return ancestors.reduceRight((children, { component, props, trigger }) => {
    const before = trigger
      ? `<${trigger.component}${attributes(trigger.component, trigger.props)}>${trigger.component}</${trigger.component}>`
      : ''
    return `<${component}${attributes(component, props)}>${before}${children}</${component}>`
  }, inner)
}

// One test per other way upstream's docs example renders the component,
// each checking the component rendered: `probe` finds what it renders (its
// own [data-subject], or for a part with no element, its data-testid child).
function usageTests(
  others: Usage[],
  element: (usage: Usage) => string,
  probe: string,
  attributes: Attributes,
): string[] {
  return others.flatMap((usage, i) => [
    '',
    `  it(${q(`renders as upstream's example uses it (${i + 2})`)}, () => {`,
    '    cleanup()',
    `    render(${scaffolded(usage.ancestors, element(usage), attributes)})`,
    `    expect(document.querySelector(${q(probe)})).not.toBeNull()`,
    '  })',
  ])
}

// A component under test: rendered inside its scaffold, with JSX attributes
// for literal props.
type Subject = { component: RenderedComponent; scaffold: Scaffold; attributes: Attributes }

// A part whose children are a function of each item (ComboboxCollection)
// renders nothing without items, which the example passes as a variable: its
// test renders it for coverage and checks only that it does not throw.
function functionChildrenTest({ component, scaffold, attributes }: Subject): string[] {
  const element = `<${component.name}${attributes(component.name, scaffold.props)}>{() => <i />}</${component.name}>`
  return [
    `describe(${q(component.name)}, () => {`,
    '  it("renders with a function of each item as its children", () => {',
    '    cleanup()',
    `    expect(() => render(${scaffolded(scaffold.ancestors, element, attributes)})).not.toThrow()`,
    '  })',
    '})',
  ]
}

// A part jsdom renders nothing for under its scaffold (NavigationMenu's
// positioner mounts only while an item is open): its test renders it for
// coverage and checks it renders nothing, for the configured reason.
function unrenderedTest({ component, scaffold, attributes }: Subject, reason: string): string[] {
  const element = `<${component.name} data-subject${attributes(component.name, scaffold.props)} />`
  return [
    `describe(${q(component.name)}, () => {`,
    `  it(${q(`renders nothing in jsdom: ${reason}`)}, () => {`,
    '    cleanup()',
    `    render(${scaffolded(scaffold.ancestors, element, attributes)})`,
    "    expect(document.querySelector('[data-subject]')).toBeNull()",
    '  })',
    '})',
  ]
}

// A part that renders no element for a className and takes no children
// (ChartStyle's <style>) is rendered and checked not to throw.
function rendersTest({ component, scaffold, attributes }: Subject): string[] {
  const element = `<${component.name}${attributes(component.name, scaffold.props)} />`
  return [
    `describe(${q(component.name)}, () => {`,
    '  it("renders", () => {',
    '    cleanup()',
    `    expect(() => render(${scaffolded(scaffold.ancestors, element, attributes)})).not.toThrow()`,
    '  })',
    '})',
  ]
}

// A part that renders no element of its own (Dialog's Root) is tested by what
// it renders: its children.
function childrenTest({ component, scaffold, attributes }: Subject): string[] {
  const element = (usage: Usage) =>
    `<${component.name}${attributes(component.name, usage.props)}><i data-testid="child" /></${component.name}>`
  return [
    `describe(${q(component.name)}, () => {`,
    '  it("renders its children", () => {',
    '    cleanup()',
    `    render(${scaffolded(scaffold.ancestors, element(scaffold), attributes)})`,
    '    expect(document.querySelector(\'[data-testid="child"]\')).not.toBeNull()',
    '  })',
    ...usageTests(scaffold.others, element, '[data-testid="child"]', attributes),
    '})',
  ]
}

// What an element's tests check beyond its scaffold.
type ElementChecks = {
  // Its cva() variants, with unstyled options' classes left out
  set: VariantSet | undefined
  // Slots the module exports no class for
  unstyled: Set<string>
  // Its props land on another item's part that renders no element
  // (CommandDialog spreads them onto Dialog's root): only its className,
  // passed on to an element, can be checked.
  detached: boolean
  // Its props' string-literal union values
  options: Record<string, string[]>
  // Props given as TypeScript expressions (CalendarDayButton's day)
  expressions: Record<string, string>
  // Props whose other values render the same here, with the reason
  sameRender: Record<string, string>
}

function componentTests(
  { component, scaffold, attributes }: Subject,
  { set, unstyled, detached, options, expressions, sameRender }: ElementChecks,
): string[] {
  const render = `render${component.name}`
  const classes = `classesOf${component.name}`
  const attributesOf = `attributesOf${component.name}`
  const html = `htmlOf${component.name}`
  // With several branches, which one renders depends on props and context:
  // the test checks it carries one of them.
  const branches = (component.branches ?? []).filter((slot) => !unstyled.has(slot))
  const expected = detached
    ? []
    : [
        ...(component.slot && !unstyled.has(component.slot) && branches.length === 0
          ? [`styles.${component.slot}`]
          : []),
        ...(set ? defaultClasses(set) : []),
      ]
  const groups = detached ? [] : (set?.groups ?? [])
  const groupNames = new Set(groups.map((group) => group.name))
  // A default can set attributes rather than classes (Separator's
  // orientation becomes data-orientation), so compare every attribute, less
  // the ids React's useId makes differ between renders.
  const explicit = detached ? [] : component.defaults.filter((d) => !groupNames.has(d.prop))

  // A test passes only the props it is about, leaving a required one
  // (AspectRatio's ratio) unset, and may pass null for a cva() group upstream
  // types without it (Bubble's align), which the variants function accepts.
  const props = `ComponentProps<typeof ${component.name}>`
  const params = `props: Partial<Record<keyof ${props}, unknown>> = {}`
  // Rendered inside its scaffold, whose popups portal out of the container,
  // so each render starts from an empty document and queries all of it.
  // The scaffold's props go in with the test's on top, as one object:
  // separate JSX attributes would repeat a required prop the test's props
  // type also holds. So do children, when it takes them (some render nothing
  // without, like FieldError): JSX children would not narrow a props union
  // (InputOTP's).
  const own = {
    ...scaffold.props,
    ...(scaffold.children ? { children: component.name } : {}),
  }
  const spread =
    Object.keys(own).length + Object.keys(expressions).length > 0
      ? objectLiteral(own, 'props', expressions)
      : 'props'
  const rendered = scaffolded(
    scaffold.ancestors,
    `<${component.name} data-subject {...(${spread} as ${props})} />`,
    attributes,
  )
  // The component under test carries data-subject, so a copy of
  // the same part its scaffold renders (Progress renders its own
  // ProgressTrack) is never the one checked. Its data-slot element is the
  // subject or encloses it (NativeSelect's wrapper around the select).
  const subject = `document.querySelector('[data-subject]')`
  const found =
    component.dataSlot === undefined
      ? subject
      : `${subject}?.closest(${q(`[data-slot="${component.dataSlot}"]`)})`
  const lines = [
    `function ${render}(${params}) {`,
    '  cleanup()',
    `  render(${rendered})`,
    `  return ${found}`,
    '}',
    '',
    // Only an element with classes of its own, or cva() groups, checks them.
    ...(expected.length > 0 || groups.length > 0 || branches.length > 0
      ? [
          `function ${classes}(${params}) {`,
          `  return ${render}(props)?.getAttribute("class")?.split(" ") ?? []`,
          '}',
          '',
        ]
      : []),
  ]
  // The whole document a render produces, ids aside, for the tests that
  // compare other prop values against the default.
  if (
    explicit.some(
      (d) =>
        (d.value === 'true' || d.value === 'false' || options[d.prop]) && !(d.prop in sameRender),
    ) ||
    (component.defaultChildren && scaffold.children)
  ) {
    lines.push(
      `function ${html}(${params}) {`,
      `  ${render}(props)`,
      '  return document.body.innerHTML.replace(USE_ID, "")',
      '}',
      '',
    )
  }
  if (explicit.length > 0) {
    lines.push(
      `function ${attributesOf}(${params}) {`,
      `  const element = ${render}(props)`,
      // Two missing elements would compare equal.
      '  expect(element).toBeTruthy()',
      '  return Object.fromEntries(',
      '    [...(element?.attributes ?? [])].map((a) => [a.name, a.value.replace(USE_ID, "")]),',
      '  )',
      '}',
      '',
    )
  }
  lines.push(`describe(${q(component.name)}, () => {`)
  if (branches.length > 0) {
    lines.push(
      `  it(${q('renders the class of one of its branches')}, () => {`,
      `    const branches = [${branches.map((slot) => `styles.${slot}`).join(', ')}]`,
      `    expect(${classes}().some((className) => branches.includes(className))).toBe(true)`,
      '  })',
      '',
    )
  }
  // An element only the consumer's className styles has no classes of its
  // own; the className test below still finds it by its data-slot.
  if (expected.length > 0) {
    lines.push(
      `  it(${q(component.dataSlot === undefined ? 'renders with its classes' : `renders [data-slot="${component.dataSlot}"] with its classes`)}, () => {`,
      `    expect(${classes}()).toEqual(expect.arrayContaining([${expected.join(', ')}]))`,
      '  })',
    )
  }

  // An option without classes has nothing to apply.
  const styledOptions = (group: VariantSet['groups'][number]) =>
    group.options.filter((o) => o.slot !== undefined)
  for (const group of groups.filter((g) => styledOptions(g).length > 0)) {
    lines.push(
      '',
      '  it.each([',
      ...styledOptions(group).map((o) => `    [${q(o.value)}, styles.${o.slot}],`),
      `  ] as const)(${q(`${group.name} %s applies its class`)}, (value, className) => {`,
      `    expect(${classes}({ ${group.name}: value })).toContain(className)`,
      '  })',
    )
  }
  if (set && groups.length > 0) {
    const nulls = groups.map((group) => `${group.name}: null`).join(', ')
    const optionClasses = groups.flatMap((group) =>
      styledOptions(group).map((o) => `styles.${o.slot}`),
    )
    lines.push(
      '',
      '  it("applies no group class for a null group", () => {',
      `    const classes = ${classes}({ ${nulls} })`,
      `    expect(classes).toContain(styles.${set.base})`,
      `    for (const className of [${optionClasses.join(', ')}]) {`,
      '      expect(classes).not.toContain(className)',
      '    }',
      '  })',
    )
  }
  for (const { prop, value } of explicit) {
    lines.push(
      '',
      `  it(${q(`renders the same with ${prop}=${value} passed explicitly`)}, () => {`,
      `    expect(${attributesOf}({ ${prop}: ${value} })).toEqual(${attributesOf}())`,
      '  })',
    )
  }
  // A default switches something on or off (DialogFooter's close button) or
  // picks one of a union's values (MessageScrollerButton's direction): each
  // other value changes what renders.
  for (const { prop, value } of explicit) {
    const others =
      value === 'true' || value === 'false'
        ? [value === 'true' ? 'false' : 'true']
        : (options[prop] ?? []).map(q).filter((option) => option !== value)
    const same = sameRender[prop]
    for (const other of others) {
      lines.push(
        '',
        ...(same === undefined
          ? [
              `  it(${q(`renders differently with ${prop}=${other}`)}, () => {`,
              `    expect(${html}({ ${prop}: ${other} })).not.toBe(${html}())`,
            ]
          : [
              `  it(${q(`renders with ${prop}=${other}, the same here: ${same}`)}, () => {`,
              `    expect(() => ${render}({ ${prop}: ${other} })).not.toThrow()`,
            ]),
        '  })',
      )
    }
  }
  if (component.defaultChildren && scaffold.children) {
    lines.push(
      '',
      '  it("renders default content in place of missing children", () => {',
      `    expect(${html}({ children: undefined })).not.toBe(${html}())`,
      '  })',
    )
  }
  if (component.throwsOutside) {
    lines.push(
      '',
      `  it(${q(`throws outside its root: ${component.throwsOutside}`)}, () => {`,
      '    cleanup()',
      `    expect(() => render(<${component.name} />)).toThrow(${q(component.throwsOutside)})`,
      '  })',
    )
  }
  lines.push(
    '',
    // The consumer's className can land inside the data-slot element
    // (AccordionContent's inner div).
    '  it("appends a consumer className last", () => {',
    `    ${render}({ className: "consumer" })`,
    '    const element = document.querySelector(".consumer")',
    '    expect(element?.getAttribute("class")?.split(" ").at(-1)).toBe("consumer")',
    '  })',
    // Other uses would lack the expression props.
    ...usageTests(
      detached || Object.keys(expressions).length > 0 ? [] : scaffold.others,
      (usage) => {
        const open = `<${component.name} data-subject${attributes(component.name, usage.props)}`
        return usage.children ? `${open}>${component.name}</${component.name}>` : `${open} />`
      },
      '[data-subject]',
      attributes,
    ),
    '})',
  )
  return lines
}

// What the tests are generated from, besides the transformed module.
export type TestInput = ItemParts & {
  // Lines to run first, each group with its reason
  setup: Omit<TestSetup, 'items'>[]
  // Slots the module exports no class for
  unstyled: Set<string>
  // Parts jsdom renders nothing for, with the reason
  unrendered: Record<string, string>
  // The module's file name, when it is not the PascalCase item (a hook's)
  module?: string
  // Props given as TypeScript expressions, by part
  expressions: Record<string, Record<string, string>>
  // Props whose other values render the same, by `Part.prop`
  sameRender: Record<string, string>
}

export function generateTest(
  name: string,
  transformed: TransformedComponent,
  parts: TestInput,
): string {
  const file = pascalCase(name)
  const module = parts.module ?? file
  const exported = exportedNames(transformed.code)
  const components = transformed.components.filter((c) => exported.has(c.name))
  const forwarded = forwardedValues(transformed.code, exported)
  const untested = [...exported].filter(
    (n) =>
      /^[A-Z]/.test(n) &&
      !components.some((c) => c.name === n) &&
      !forwarded.some((r) => r.name === n),
  )
  const hooks = transformed.hooks.filter((hook) => exported.has(hook.name))
  if (components.length + forwarded.length + hooks.length === 0 || untested.length > 0) {
    throw new Error(
      `${name}: no test template for ${untested.join(', ') || "this component's shape"} yet`,
    )
  }

  // A slot the module exports no class for is left out of what the tests
  // expect, as its option has no class to apply.
  const sets = new Map(
    transformed.variantSets.map((set) => [
      set.variable,
      {
        ...set,
        groups: set.groups.map((group) => ({
          ...group,
          options: group.options.map((option) =>
            option.slot && parts.unstyled.has(option.slot) ? { value: option.value } : option,
          ),
        })),
      },
    ]),
  )
  const functions = [...sets.values()].filter((set) => exported.has(set.variable))
  const scaffold = (component: string): Scaffold =>
    parts.scaffolds.get(component) ?? { ancestors: [], props: {}, children: true, others: [] }
  // Hooks run inside the provider their error names (useSidebar's
  // SidebarProvider), or else the item's root component.
  const named = (hook: Hook) =>
    [...exported]
      .filter((n) => /^[A-Z]/.test(n) && new RegExp(`\\b${n}\\b`).test(hook.throws ?? ''))
      .sort((a, b) => b.length - a.length)[0]
  const itemRoot = [...exported].find((n) => n.toLowerCase() === file.toLowerCase())
  const rootOf = (hook: Hook) => named(hook) ?? itemRoot
  const imports = new Set([
    ...hooks.map((hook) => hook.name),
    ...hooks.flatMap((hook) => rootOf(hook) ?? []),
    ...components.flatMap((c) => [c.name, ...scaffold(c.name).ancestors.map((a) => a.component)]),
    ...functions.map((set) => set.variable),
    ...forwarded.map((r) => r.name),
  ])

  const attributes = attributesFor(parts.types)
  const testsFor = (component: RenderedComponent): string[] => {
    const subject = { component, scaffold: scaffold(component.name), attributes }
    const types = parts.types.get(component.name)
    const unrendered = parts.unrendered[component.name]
    if (unrendered !== undefined) return unrenderedTest(subject, unrendered)
    if (types?.childrenFunction) return functionChildrenTest(subject)
    if (types?.className === false) {
      return types.text === false ? rendersTest(subject) : childrenTest(subject)
    }
    return componentTests(subject, {
      set: component.variantSet ? sets.get(component.variantSet) : undefined,
      unstyled: parts.unstyled,
      detached: parts.external.get(component.tag ?? '')?.className === false,
      options: types?.options ?? {},
      expressions: parts.expressions[component.name] ?? {},
      sameRender: Object.fromEntries(
        Object.entries(parts.sameRender)
          .filter(([key]) => key.startsWith(`${component.name}.`))
          .map(([key, reason]) => [key.slice(component.name.length + 1), reason]),
      ),
    })
  }
  const body = [
    ...parts.setup.flatMap(({ lines, reason }) => ['', `// ${reason}`, ...lines]),
    ...components.flatMap((component) => ['', ...testsFor(component)]),
    ...(forwarded.length > 0
      ? [
          '',
          'describe("re-exports", () => {',
          ...forwarded.flatMap(({ name, original, from }, i) => [
            ...(i > 0 ? [''] : []),
            `  it(${q(`re-exports ${name} from ${from}`)}, () => {`,
            `    expect(${name}).toBe(${original})`,
            '  })',
          ]),
          '})',
        ]
      : []),
    ...hooks.flatMap((hook) => {
      const root = rootOf(hook)
      return [
        '',
        `describe(${q(hook.name)}, () => {`,
        `  it(${q(root ? `runs inside ${root}` : 'runs in a component')}, () => {`,
        '    cleanup()',
        root
          ? `    const { result } = renderHook(() => ${hook.name}(), { wrapper: ({ children }) => <${root}${attributes(root, scaffold(root).props)}>{children}</${root}> })`
          : `    const { result } = renderHook(() => ${hook.name}())`,
        '    expect(result.current).toBeDefined()',
        '  })',
        ...(hook.throws === undefined
          ? []
          : [
              '',
              `  it(${q(`throws outside its root: ${hook.throws}`)}, () => {`,
              `    expect(() => renderHook(() => ${hook.name}())).toThrow(${q(hook.throws)})`,
              '  })',
            ]),
        '})',
      ]
    }),
    ...functions.flatMap((set) => [
      '',
      `describe(${q(set.variable)}, () => {`,
      '  it("applies the base and default classes when called with no arguments", () => {',
      `    expect(${set.variable}()).toBe([${defaultClasses(set).join(', ')}].join(" "))`,
      '  })',
      '})',
    ]),
    '',
  ].join('\n')
  // Imports and constants for what the body uses.
  const useId = body.includes('USE_ID')
    ? [
        '',
        "// React's useId output (_r_1_, and :r1: or «r1» before React 19.1), which",
        '// differs between renders; Base UI puts it in ids and data-id.',
        'const USE_ID = /_r_[0-9a-z]+_|:r[0-9a-z]+:|«r[0-9a-z]+»/g',
      ]
    : []
  const rendering = components.length > 0 || hooks.length > 0
  return [
    ...(rendering
      ? [
          `import { ${['cleanup', ...(body.includes('render(') ? ['render'] : []), ...(hooks.length > 0 ? ['renderHook'] : [])].join(', ')} } from "@testing-library/react"`,
        ]
      : []),
    ...new Set(forwarded.map((f) => f.importLine)),
    ...(body.includes('ComponentProps<') ? ['import type { ComponentProps } from "react"'] : []),
    `import { ${rendering ? 'afterEach, ' : ''}describe, expect, it } from "vitest"`,
    `import { ${[...imports].sort().join(', ')} } from "./${module}"`,
    ...(body.includes('styles.') ? [`import styles from "./${module}.module.scss"`] : []),
    ...useId,
    // Unmount after each test, so no render's scheduled work outlives the
    // file's jsdom environment (InputOTP's timers on a slow runner).
    ...(rendering ? ['', 'afterEach(cleanup)'] : []),
    body,
  ].join('\n')
}
