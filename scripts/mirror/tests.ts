// Generates the test file shipped with each component. Upstream publishes no
// tests, so they are derived from what the transform learned: each exported
// component's data-slot, its own module class, the cva() variant groups it
// applies, and its literal prop defaults. Assertions go through the `styles`
// import, so they hold whatever class names the consumer's CSS module setup
// produces.

import { parseModule } from './ast.ts'
import { pascalCase } from './names.ts'
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

function componentTests(component: RenderedComponent, set: VariantSet | undefined): string[] {
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

  const lines = [
    `function ${render}(props: ComponentProps<typeof ${component.name}> = {}) {`,
    `  const { container } = render(<${component.name} {...props} />)`,
    `  return container.querySelector(${element})?.className.split(" ") ?? []`,
    '}',
    '',
  ]
  if (explicit.length > 0) {
    lines.push(
      `function ${attributes}(props: ComponentProps<typeof ${component.name}> = {}) {`,
      `  const { container } = render(<${component.name} {...props} />)`,
      `  const element = container.querySelector(${element})`,
      '  return Object.fromEntries(',
      '    [...(element?.attributes ?? [])].filter((a) => a.name !== "id").map((a) => [a.name, a.value]),',
      '  )',
      '}',
      '',
    )
  }
  lines.push(
    `describe(${q(component.name)}, () => {`,
    `  it(${q(`renders [data-slot="${component.dataSlot}"] with its classes`)}, () => {`,
    `    expect(${render}()).toEqual(expect.arrayContaining([${expected.join(', ')}]))`,
    '  })',
  )

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

export function generateTest(name: string, transformed: TransformedComponent): string {
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
  // Sorted the way Biome's organizeImports expects.
  const imports = [...components.map((c) => c.name), ...functions.map((set) => set.variable)].sort()

  return [
    'import { render } from "@testing-library/react"',
    'import type { ComponentProps } from "react"',
    'import { describe, expect, it } from "vitest"',
    `import { ${imports.join(', ')} } from "./${file}"`,
    `import styles from "./${file}.module.scss"`,
    ...components.flatMap((component) => [
      '',
      ...componentTests(
        component,
        component.variantSet ? sets.get(component.variantSet) : undefined,
      ),
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
