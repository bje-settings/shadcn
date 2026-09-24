// Turns an upstream `<item>-example` (the demo behind shadcn's docs page) into
// A/B cases: each sub-example the default export renders becomes a case when
// everything it reaches is available, which is mirrored components, the
// harness's stand-ins for docs-only imports, and react.
//
// The output is two trimmed copies of the example holding only the kept
// sub-examples, the top-level code they reach and the imports they use, with
// the kept sub-examples exported. The upstream copy keeps upstream's imports;
// ours points registry imports at this registry's components. Everything else
// is upstream's code as written.

import { parse } from '@babel/parser'
import type { Identifier, ImportDeclaration, Node, SourceLocation, Statement } from '@babel/types'
import MagicString from 'magic-string'
import { pascalCase } from './names.ts'

// Imports the harness provides stand-ins for (ab/stubs).
export const STUBBED = new Set(['components/example', '@/app/(create)/components/icon-placeholder'])

export type PreparedExample = {
  upstream: string
  ours: string
  kept: string[]
  skipped: { name: string; missing: string[] }[]
}

function span(node: Node): [number, number] {
  return [node.start as number, node.end as number]
}

// Names a statement declares at the top level. A top-level function
// declaration always has a name; only `export default function` may not.
function declared(statement: Statement): string[] {
  if (
    statement.type === 'FunctionDeclaration' ||
    statement.type === 'TSTypeAliasDeclaration' ||
    statement.type === 'TSInterfaceDeclaration'
  ) {
    return [(statement.id as Identifier).name]
  }
  if (
    statement.type === 'VariableDeclaration' &&
    statement.declarations.every((d) => d.id.type === 'Identifier')
  ) {
    return statement.declarations.map((d) => (d.id as Identifier).name)
  }
  return []
}

// Identifiers a node refers to, ignoring property keys and JSX attribute names.
function references(node: Node): Set<string> {
  const names = new Set<string>()
  const visit = (current: Node, parent: Node | undefined) => {
    if (current.type === 'Identifier' || current.type === 'JSXIdentifier') {
      const key =
        (parent?.type === 'ObjectProperty' && parent.key === current && !parent.computed) ||
        (parent?.type === 'MemberExpression' && parent.property === current && !parent.computed) ||
        (parent?.type === 'JSXMemberExpression' && parent.property === current) ||
        parent?.type === 'JSXAttribute'
      if (!key) names.add(current.name)
    }
    for (const [field, value] of Object.entries(current)) {
      if (field === 'loc' || field === 'extra' || field.endsWith('Comments')) continue
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child && typeof child === 'object' && typeof child.type === 'string')
          visit(child, current)
      }
    }
  }
  visit(node, undefined)
  return names
}

// The kept part of an import, up to its `from`, or undefined when nothing is kept.
function importHead(declaration: ImportDeclaration, keep: Set<string>): string | undefined {
  const kept = declaration.specifiers.filter((s) => keep.has(s.local.name))
  if (kept.length === 0) return undefined
  const named = kept.flatMap((s) => {
    if (s.type !== 'ImportSpecifier') return []
    const imported =
      s.imported.type === 'Identifier' ? s.imported.name : JSON.stringify(s.imported.value)
    const name = imported === s.local.name ? imported : `${imported} as ${s.local.name}`
    return [s.importKind === 'type' ? `type ${name}` : name]
  })
  const parts = [
    ...kept.flatMap((s) => (s.type === 'ImportDefaultSpecifier' ? [s.local.name] : [])),
    ...kept.flatMap((s) => (s.type === 'ImportNamespaceSpecifier' ? [`* as ${s.local.name}`] : [])),
    ...(named.length > 0 ? [`{ ${named.join(', ')} }`] : []),
  ]
  return `import ${declaration.importKind === 'type' ? 'type ' : ''}${parts.join(', ')} from`
}

export function prepareExample(
  source: string,
  style: string,
  namespace: string,
  mirrored: Set<string>,
): PreparedExample {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
  const registry = `@/registry/${style}/`
  const imports = new Map<string, ImportDeclaration>()
  const declarations = new Map<string, Statement>()
  let order: string[] = []

  for (const statement of ast.program.body) {
    if (statement.type === 'ImportDeclaration') {
      for (const s of statement.specifiers) imports.set(s.local.name, statement)
    } else if (statement.type === 'ExportDefaultDeclaration') {
      const listed = references(statement.declaration)
      order = [...listed].filter((name) => /^[A-Z]/.test(name))
    } else {
      // Trimming removes whatever no kept sub-example reaches, so only
      // statements whose names can be followed are safe to see here.
      const names = declared(statement)
      if (names.length === 0) {
        throw new Error(
          `example: unsupported top-level ${statement.type} at line ${(statement.loc as SourceLocation).start.line}`,
        )
      }
      for (const name of names) declarations.set(name, statement)
    }
  }
  order = order.filter((name) => declarations.has(name))
  if (order.length === 0) {
    throw new Error('example: the default export renders no sub-example functions')
  }

  // Everything a sub-example reaches: top-level declarations and imports.
  const reach = (name: string) => {
    const seen = new Set<string>([name])
    const queue = [name]
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      for (const ref of references(declarations.get(next) as Node)) {
        if (!seen.has(ref) && (declarations.has(ref) || imports.has(ref))) {
          seen.add(ref)
          if (declarations.has(ref)) queue.push(ref)
        }
      }
    }
    return seen
  }

  const available = (from: string): string | undefined => {
    if (from === 'react') return undefined
    const local = from.startsWith(registry) ? from.slice(registry.length) : from
    if (STUBBED.has(local)) return undefined
    const item = local.startsWith('ui/') ? local.slice(3) : undefined
    return item !== undefined && mirrored.has(item) ? undefined : (item ?? from)
  }

  const kept: string[] = []
  const skipped: PreparedExample['skipped'] = []
  const keep = new Set<string>()
  for (const name of order) {
    const reached = reach(name)
    const missing = [
      ...new Set(
        [...reached]
          .filter((ref) => imports.has(ref))
          .flatMap((ref) => {
            const gap = available((imports.get(ref) as ImportDeclaration).source.value)
            return gap === undefined ? [] : [gap]
          }),
      ),
    ].sort()
    if (missing.length > 0) {
      skipped.push({ name, missing })
      continue
    }
    kept.push(name)
    for (const ref of reached) keep.add(ref)
  }

  const trimmed = (rewrite: boolean) => {
    const out = new MagicString(source)
    // Take the statement's line break with it, so removed runs leave no gap.
    const remove = (statement: Statement) => {
      const end = statement.end as number
      out.remove(statement.start as number, source[end] === '\n' ? end + 1 : end)
    }
    for (const statement of ast.program.body) {
      if (statement.type === 'ImportDeclaration') {
        const head = importHead(statement, keep)
        if (head === undefined) {
          remove(statement)
          continue
        }
        out.overwrite(statement.start as number, statement.source.start as number, `${head} `)
        const from = statement.source.value
        const item = from.startsWith(`${registry}ui/`) ? from.slice(registry.length + 3) : undefined
        if (rewrite && item) {
          const file = pascalCase(item)
          out.overwrite(
            ...span(statement.source),
            JSON.stringify(`@/registry/${namespace}/ui/${file}/${file}`),
          )
        }
      } else if (!declared(statement).some((name) => keep.has(name))) {
        remove(statement)
      }
    }
    out.append(`\nexport { ${kept.join(', ')} }\n`)
    return out.toString().replace(/\n{3,}/g, '\n\n')
  }

  return { upstream: trimmed(false), ours: trimmed(true), kept, skipped }
}
