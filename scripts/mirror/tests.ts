// Generates the test file shipped with each component. Upstream publishes no
// tests, so they are derived from what the transform learned: each exported
// component's data-slot, its own module class, the cva() variant groups it
// applies, and its literal prop defaults. Assertions go through the `styles`
// import, so they hold whatever class names the consumer's CSS module setup
// produces.

import { parseModule } from './ast.ts'
import { pascalCase } from './names.ts'
import type { Literal, Part, PartTypes, Scaffold } from './parts.ts'
import type { RenderedComponent, TransformedComponent, VariantSet } from './tsx.ts'

export function exportedNames(code: string): Set<string> {
  const ast = parseModule(code)
  const names = new Set<string>()
  for (const statement of ast.program.body) {
    if (statement.type !== 'ExportNamedDeclaration') continue
    for (const specifier of statement.specifiers) {
      if (specifier.type === 'ExportSpecifier' && specifier.exported.type === 'Identifier') {
        names.add(specifier.exported.name)
      }
    }
    if (statement.declaration?.type === 'FunctionDeclaration' && statement.declaration.id) {
      names.add(statement.declaration.id.name)
    }
  }
  return names
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

function jsxProps(props: Record<string, Literal>): string {
  return Object.entries(props)
    .map(([name, value]) => {
      if (value === true) return ` ${name}`
      return ` ${name}=${typeof value === 'string' ? q(value) : `{${JSON.stringify(value)}}`}`
    })
    .join('')
}

// `inner` rendered inside the scaffold's ancestors.
function scaffolded(ancestors: Part[], inner: string): string {
  return ancestors.reduceRight(
    (children, { component, props }) =>
      `<${component}${jsxProps(props)}>${children}</${component}>`,
    inner,
  )
}

// A part that renders no element of its own (Dialog's Root) is tested by what
// it renders: its children.
function childrenTest(component: RenderedComponent, scaffold: Scaffold): string[] {
  const inner = `<${component.name}${jsxProps(scaffold.props)}><i data-testid="child" /></${component.name}>`
  return [
    `describe(${q(component.name)}, () => {`,
    '  it("renders its children", () => {',
    `    render(${scaffolded(scaffold.ancestors, inner)})`,
    '    expect(document.querySelector(\'[data-testid="child"]\')).not.toBeNull()',
    '  })',
    '})',
  ]
}

function componentTests(
  component: RenderedComponent,
  set: VariantSet | undefined,
  scaffold: Scaffold,
): string[] {
  const render = `render${component.name}`
  const attributes = `attributesOf${component.name}`
  const element = q(`[data-slot="${component.dataSlot}"]`)
  const expected = [
    ...(component.slot ? [`styles.${component.slot}`] : []),
    ...(set ? defaultClasses(set) : []),
  ]
  const groups = set?.groups ?? []
  const groupNames = new Set(groups.map((group) => group.name))
  // A default can set attributes rather than classes (Separator's
  // orientation becomes data-orientation), so compare every attribute except
  // id, which React's useId makes differ between renders.
  const explicit = component.defaults.filter((d) => !groupNames.has(d.prop))

  // Partial: a test passes only the props it is about, and leaves a required
  // one (AspectRatio's ratio) unset.
  const props = `ComponentProps<typeof ${component.name}>`
  // Rendered inside its scaffold, whose popups portal out of the container,
  // so each render starts from an empty document and queries all of it.
  const rendered = scaffolded(
    scaffold.ancestors,
    `<${component.name}${jsxProps(scaffold.props)} {...(props as ${props})} />`,
  )
  const lines = [
    `function ${render}(props: Partial<${props}> = {}) {`,
    '  cleanup()',
    `  render(${rendered})`,
    `  return document.querySelector(${element})?.getAttribute("class")?.split(" ") ?? []`,
    '}',
    '',
  ]
  if (explicit.length > 0) {
    lines.push(
      `function ${attributes}(props: Partial<${props}> = {}) {`,
      '  cleanup()',
      `  render(${rendered})`,
      `  const element = document.querySelector(${element})`,
      '  return Object.fromEntries(',
      '    [...(element?.attributes ?? [])].filter((a) => a.name !== "id").map((a) => [a.name, a.value]),',
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
      `    expect(${render}()).toEqual(expect.arrayContaining([${expected.join(', ')}]))`,
      '  })',
    )
  }

  for (const group of groups) {
    lines.push(
      '',
      '  it.each([',
      ...group.options.map((o) => `    [${q(o.value)}, styles.${o.slot}],`),
      `  ] as const)(${q(`${group.name} %s applies its class`)}, (value, className) => {`,
      `    expect(${render}({ ${group.name}: value })).toContain(className)`,
      '  })',
    )
  }
  if (set && groups.length > 0) {
    const nulls = groups.map((group) => `${group.name}: null`).join(', ')
    const optionClasses = groups.flatMap((group) => group.options.map((o) => `styles.${o.slot}`))
    lines.push(
      '',
      '  it("applies no group class for a null group", () => {',
      `    const classes = ${render}({ ${nulls} })`,
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
      `    expect(${attributes}({ ${prop}: ${value} })).toEqual(${attributes}())`,
      '  })',
    )
  }
  lines.push(
    '',
    '  it("appends a consumer className last", () => {',
    `    expect(${render}({ className: "consumer" }).at(-1)).toBe("consumer")`,
    '  })',
    '})',
  )
  return lines
}

export function generateTest(
  name: string,
  transformed: TransformedComponent,
  parts: { types: Map<string, PartTypes>; scaffolds: Map<string, Scaffold> },
): string {
  const file = pascalCase(name)
  const exported = exportedNames(transformed.code)
  const components = transformed.components.filter((c) => exported.has(c.name))
  const untested = [...exported].filter(
    (n) => /^[A-Z]/.test(n) && !components.some((c) => c.name === n),
  )
  if (components.length === 0 || untested.length > 0) {
    throw new Error(
      `${name}: no test template for ${untested.join(', ') || "this component's shape"} yet`,
    )
  }

  const sets = new Map(transformed.variantSets.map((set) => [set.variable, set]))
  const functions = [...sets.values()].filter((set) => exported.has(set.variable))
  const scaffold = (component: string): Scaffold =>
    parts.scaffolds.get(component) ?? { ancestors: [], props: {}, children: true }
  const elementless = (component: RenderedComponent) =>
    parts.types.get(component.name)?.className === false
  const styled = components.some((component) => !elementless(component))
  const imports = new Set([
    ...components.flatMap((c) => [c.name, ...scaffold(c.name).ancestors.map((a) => a.component)]),
    ...functions.map((set) => set.variable),
  ])

  return [
    `import { ${styled ? 'cleanup, ' : ''}render } from "@testing-library/react"`,
    ...(styled ? ['import type { ComponentProps } from "react"'] : []),
    'import { describe, expect, it } from "vitest"',
    `import { ${[...imports].sort().join(', ')} } from "./${file}"`,
    ...(styled || functions.length > 0 ? [`import styles from "./${file}.module.scss"`] : []),
    ...components.flatMap((component) => [
      '',
      ...(elementless(component)
        ? childrenTest(component, scaffold(component.name))
        : componentTests(
            component,
            component.variantSet ? sets.get(component.variantSet) : undefined,
            scaffold(component.name),
          )),
    ]),
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
}
