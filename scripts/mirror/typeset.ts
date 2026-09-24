// shadcn/typeset's builder previews against content fixtures: TypeScript
// modules exporting HTML strings (`export const DOCS_HTML = \`...\``). The A/B
// harness renders each inside `.typeset` on both pages, so this reads the
// `*_HTML` exports out of a fixture's source without running it.

import { parse } from '@babel/parser'
import type { TemplateElement } from '@babel/types'

export type TypesetFixture = { name: string; html: string }

export function fixtureHtml(name: string, source: string): TypesetFixture[] {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] })
  const found = ast.program.body.flatMap((statement) => {
    if (statement.type !== 'ExportNamedDeclaration') return []
    const declaration = statement.declaration
    if (declaration?.type !== 'VariableDeclaration') return []
    return declaration.declarations.flatMap((d) => {
      if (d.id.type !== 'Identifier' || !d.id.name.endsWith('_HTML')) return []
      const init = d.init
      if (init?.type === 'StringLiteral') return [init.value]
      if (init?.type === 'TemplateLiteral' && init.expressions.length === 0) {
        // One quasi with no expressions; `cooked` is set for valid escapes.
        return [(init.quasis[0] as TemplateElement).value.cooked as string]
      }
      throw new Error(`typeset fixture ${name}: ${d.id.name} is not a plain string`)
    })
  })
  if (found.length === 0) throw new Error(`typeset fixture ${name}: no *_HTML export`)
  return found.map((html, i) => ({ name: found.length > 1 ? `${name}-${i + 1}` : name, html }))
}
