// Generates the test file shipped with each component. Upstream publishes no
// tests, so they are derived from what the transform learned: the cva()
// variant groups, their defaults, and the component and data-slot that render
// them. Assertions go through the `styles` import, so they hold whatever
// class names the consumer's CSS module setup produces.

import { parse } from '@babel/parser'
import { pascalCase } from './names.ts'
import type { TransformedComponent } from './tsx.ts'

function exportedNames(code: string): Set<string> {
  const ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
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

export function generateTest(name: string, transformed: TransformedComponent): string {
  const component = pascalCase(name)
  const exported = exportedNames(transformed.code)
  const set = transformed.variantSets.find((s) => s.renderedBy?.component === component)
  if (!set?.renderedBy || !exported.has(component)) {
    throw new Error(`${name}: no test template for this component's shape yet`)
  }

  const selector = `[data-slot="${set.renderedBy.dataSlot}"]`
  const render = `render${component}`
  const defaults = [
    `styles.${set.base}`,
    ...set.groups.flatMap((group) => {
      const option = group.options.find((o) => o.value === group.default)
      return option ? [`styles.${option.slot}`] : []
    }),
  ]
  const imports = [component, ...(exported.has(set.variable) ? [set.variable] : [])]

  const groupTests = set.groups.flatMap((group) => [
    '',
    '  it.each([',
    ...group.options.map((o) => `    [${JSON.stringify(o.value)}, styles.${o.slot}],`),
    `  ] as const)("${group.name} %s applies its class", (value, className) => {`,
    `    expect(${render}({ ${group.name}: value })).toContain(className)`,
    '  })',
  ])
  const nulls = set.groups.map((group) => `${group.name}: null`).join(', ')

  return [
    'import { render } from "@testing-library/react"',
    'import type { ComponentProps } from "react"',
    'import { describe, expect, it } from "vitest"',
    `import { ${imports.join(', ')} } from "./${component}"`,
    `import styles from "./${component}.module.scss"`,
    '',
    `function ${render}(props: ComponentProps<typeof ${component}> = {}) {`,
    `  const { container } = render(<${component} {...props} />)`,
    `  return container.querySelector(${JSON.stringify(selector)})?.className.split(" ") ?? []`,
    '}',
    '',
    `describe("${component}", () => {`,
    `  it(${JSON.stringify(`renders ${selector} with the base and default classes`)}, () => {`,
    `    expect(${render}()).toEqual([${defaults.join(', ')}])`,
    '  })',
    ...groupTests,
    ...(set.groups.length > 0
      ? [
          '',
          '  it("applies no group class for a null group", () => {',
          `    expect(${render}({ ${nulls} })).toEqual([styles.${set.base}])`,
          '  })',
        ]
      : []),
    '',
    '  it("appends a consumer className last", () => {',
    `    expect(${render}({ className: "consumer" }).at(-1)).toBe("consumer")`,
    '  })',
    '})',
    ...(exported.has(set.variable)
      ? [
          '',
          `describe("${set.variable}", () => {`,
          '  it("applies the base and default classes when called with no arguments", () => {',
          `    expect(${set.variable}()).toBe([${defaults.join(', ')}].join(" "))`,
          '  })',
          '})',
        ]
      : []),
    '',
  ].join('\n')
}
