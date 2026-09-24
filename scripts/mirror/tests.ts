// Generates the test file shipped with each component. Upstream publishes no
// tests, so they are derived from what the transform learned: each exported
// component's data-slot, its own module class, the cva() variant groups it
// applies, and its literal prop defaults. Assertions go through the `styles`
// import, so they hold whatever class names the consumer's CSS module setup
// produces.

import { parseModule } from './ast.ts'
import { camelCase, pascalCase } from './names.ts'
import type { Literal, Part, PartTypes, Scaffold, Usage } from './parts.ts'
import type { RenderedComponent, TransformedComponent, VariantSet } from './tsx.ts'

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

// Values a module re-exports from a package, like `export { DirectionProvider }
// from "@base-ui/react/direction-provider"`.
function reexports(code: string): { name: string; imported: string; from: string }[] {
  return parseModule(code).program.body.flatMap((statement) => {
    if (statement.type !== 'ExportNamedDeclaration' || !statement.source) return []
    if (statement.exportKind === 'type') return []
    const from = statement.source.value
    return statement.specifiers.flatMap((specifier) =>
      specifier.type === 'ExportSpecifier' &&
      specifier.exportKind !== 'type' &&
      specifier.exported.type === 'Identifier'
        ? [{ name: specifier.exported.name, imported: specifier.local.name, from }]
        : [],
    )
  })
}

const q = (value: string) => JSON.stringify(value)

function defaultClasses(set: VariantSet): string[] {
  return [
    `styles.${set.base}`,
    ...set.groups.flatMap((group) => {
      const option = group.options.find((o) => o.value === group.default)
      return option ? [`styles.${option.slot}`] : []
    }),
  ]
}

function objectLiteral(props: Record<string, Literal>, rest?: string): string {
  const entries = Object.entries(props).map(
    ([name, value]) => `${q(name)}: ${JSON.stringify(value)}`,
  )
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
        return ` ${name}=${typeof value === 'string' ? q(value) : `{${JSON.stringify(value)}}`}`
      })
      .join('')
  }
}

// `inner` rendered inside the scaffold's ancestors.
function scaffolded(ancestors: Part[], inner: string, attributes: Attributes): string {
  return ancestors.reduceRight(
    (children, { component, props }) =>
      `<${component}${attributes(component, props)}>${children}</${component}>`,
    inner,
  )
}

// One test per other way upstream's docs example renders the component,
// each checking the component rendered: `probe` is what it renders (its own
// data-testid, or a child's).
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

// A part that renders no element of its own (Dialog's Root) is tested by what
// it renders: its children.
function childrenTest(
  component: RenderedComponent,
  scaffold: Scaffold,
  attributes: Attributes,
): string[] {
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

function componentTests(
  component: RenderedComponent,
  set: VariantSet | undefined,
  scaffold: Scaffold,
  attributes: Attributes,
): string[] {
  const render = `render${component.name}`
  const classes = `classesOf${component.name}`
  const attributesOf = `attributesOf${component.name}`
  const expected = [
    ...(component.slot ? [`styles.${component.slot}`] : []),
    ...(set ? defaultClasses(set) : []),
  ]
  const groups = set?.groups ?? []
  const groupNames = new Set(groups.map((group) => group.name))
  // A default can set attributes rather than classes (Separator's
  // orientation becomes data-orientation), so compare every attribute, less
  // the ids React's useId makes differ between renders.
  const explicit = component.defaults.filter((d) => !groupNames.has(d.prop))

  // Partial: a test passes only the props it is about, and leaves a required
  // one (AspectRatio's ratio) unset.
  const props = `ComponentProps<typeof ${component.name}>`
  // Rendered inside its scaffold, whose popups portal out of the container,
  // so each render starts from an empty document and queries all of it.
  // The scaffold's props go in with the test's on top, as one object:
  // separate JSX attributes would repeat a required prop the test's props
  // type also holds.
  const own =
    Object.keys(scaffold.props).length > 0 ? objectLiteral(scaffold.props, 'props') : 'props'
  const rendered = scaffolded(
    scaffold.ancestors,
    `<${component.name} data-testid="subject" {...(${own} as ${props})} />`,
    attributes,
  )
  // The component under test carries data-testid="subject", so a copy of
  // the same part its scaffold renders (Progress renders its own
  // ProgressTrack) is never the one checked. Its data-slot element is the
  // subject or encloses it (NativeSelect's wrapper around the select).
  const slot = q(`[data-slot="${component.dataSlot}"]`)
  const lines = [
    `function ${render}(props: Partial<${props}> = {}) {`,
    '  cleanup()',
    `  render(${rendered})`,
    `  return document.querySelector('[data-testid="subject"]')?.closest(${slot})`,
    '}',
    '',
    // Only an element with classes of its own, or cva() groups, checks them.
    ...(expected.length > 0 || groups.length > 0
      ? [
          `function ${classes}(props: Partial<${props}> = {}) {`,
          `  return ${render}(props)?.getAttribute("class")?.split(" ") ?? []`,
          '}',
          '',
        ]
      : []),
  ]
  if (explicit.length > 0) {
    lines.push(
      `function ${attributesOf}(props: Partial<${props}> = {}) {`,
      `  const element = ${render}(props)`,
      '  return Object.fromEntries(',
      '    [...(element?.attributes ?? [])].map((a) => [a.name, a.value.replace(USE_ID, "")]),',
      '  )',
      '}',
      '',
    )
  }
  lines.push(`describe(${q(component.name)}, () => {`)
  // An element only the consumer's className styles has no classes of its
  // own; the className test below still finds it by its data-slot.
  if (expected.length > 0) {
    lines.push(
      `  it(${q(`renders [data-slot="${component.dataSlot}"] with its classes`)}, () => {`,
      `    expect(${classes}()).toEqual(expect.arrayContaining([${expected.join(', ')}]))`,
      '  })',
    )
  }

  for (const group of groups) {
    lines.push(
      '',
      '  it.each([',
      ...group.options.map((o) => `    [${q(o.value)}, styles.${o.slot}],`),
      `  ] as const)(${q(`${group.name} %s applies its class`)}, (value, className) => {`,
      `    expect(${classes}({ ${group.name}: value })).toContain(className)`,
      '  })',
    )
  }
  if (set && groups.length > 0) {
    const nulls = groups.map((group) => `${group.name}: null`).join(', ')
    const optionClasses = groups.flatMap((group) => group.options.map((o) => `styles.${o.slot}`))
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
  lines.push(
    '',
    // The consumer's className can land inside the data-slot element
    // (AccordionContent's inner div).
    '  it("appends a consumer className last", () => {',
    `    ${render}({ className: "consumer" })`,
    '    const element = document.querySelector(".consumer")',
    '    expect(element?.getAttribute("class")?.split(" ").at(-1)).toBe("consumer")',
    '  })',
    ...usageTests(
      scaffold.others,
      (usage) => {
        const open = `<${component.name} data-testid="subject"${attributes(component.name, usage.props)}`
        return usage.children ? `${open}>${component.name}</${component.name}>` : `${open} />`
      },
      '[data-testid="subject"]',
      attributes,
    ),
    '})',
  )
  return lines
}

export function generateTest(
  name: string,
  transformed: TransformedComponent,
  parts: {
    types: Map<string, PartTypes>
    scaffolds: Map<string, Scaffold>
  },
): string {
  const file = pascalCase(name)
  const exported = exportedNames(transformed.code)
  const components = transformed.components.filter((c) => exported.has(c.name))
  const forwarded = reexports(transformed.code)
  const untested = [...exported].filter(
    (n) =>
      /^[A-Z]/.test(n) &&
      !components.some((c) => c.name === n) &&
      !forwarded.some((r) => r.name === n),
  )
  if ((components.length === 0 && forwarded.length === 0) || untested.length > 0) {
    throw new Error(
      `${name}: no test template for ${untested.join(', ') || "this component's shape"} yet`,
    )
  }

  const sets = new Map(transformed.variantSets.map((set) => [set.variable, set]))
  const functions = [...sets.values()].filter((set) => exported.has(set.variable))
  const scaffold = (component: string): Scaffold =>
    parts.scaffolds.get(component) ?? { ancestors: [], props: {}, children: true, others: [] }
  const elementless = (component: RenderedComponent) =>
    parts.types.get(component.name)?.className === false
  const usesIds = components.some(
    (component) =>
      !elementless(component) &&
      component.defaults.some(
        (d) => !(sets.get(component.variantSet ?? '')?.groups ?? []).some((g) => g.name === d.prop),
      ),
  )
  const imports = new Set([
    ...components.flatMap((c) => [c.name, ...scaffold(c.name).ancestors.map((a) => a.component)]),
    ...functions.map((set) => set.variable),
    ...forwarded.map((r) => r.name),
  ])
  // Each package a value is re-exported from, as a namespace import.
  const sources = [...new Set(forwarded.map((r) => r.from))]
  const namespace = (from: string) => camelCase(from.split('/').at(-1) as string)

  const attributes = attributesFor(parts.types)
  const body = [
    ...(usesIds
      ? [
          '',
          "// React's useId output (_r_1_, and :r1: or «r1» before React 19.1), which",
          '// differs between renders; Base UI puts it in ids and data-id.',
          'const USE_ID = /_r_[0-9a-z]+_|:r[0-9a-z]+:|«r[0-9a-z]+»/g',
        ]
      : []),
    ...components.flatMap((component) => [
      '',
      ...(elementless(component)
        ? childrenTest(component, scaffold(component.name), attributes)
        : componentTests(
            component,
            component.variantSet ? sets.get(component.variantSet) : undefined,
            scaffold(component.name),
            attributes,
          )),
    ]),
    ...(forwarded.length > 0
      ? [
          '',
          'describe("re-exports", () => {',
          ...forwarded.flatMap(({ name, imported, from }, i) => [
            ...(i > 0 ? [''] : []),
            `  it(${q(`re-exports ${name} from ${from}`)}, () => {`,
            `    expect(${name}).toBe(${namespace(from)}.${imported})`,
            '  })',
          ]),
          '})',
        ]
      : []),
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
  // Imports for what the body uses.
  return [
    ...(components.length > 0 ? ['import { cleanup, render } from "@testing-library/react"'] : []),
    ...sources.map((from) => `import * as ${namespace(from)} from ${q(from)}`),
    ...(body.includes('ComponentProps<') ? ['import type { ComponentProps } from "react"'] : []),
    'import { describe, expect, it } from "vitest"',
    `import { ${[...imports].sort().join(', ')} } from "./${file}"`,
    ...(body.includes('styles.') ? [`import styles from "./${file}.module.scss"`] : []),
    body,
  ].join('\n')
}
