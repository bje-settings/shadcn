// Turns an upstream `<item>-example` (the demo behind shadcn's docs page) into
// A/B cases: each sub-example the default export renders becomes a case when
// everything it reaches is available, which is mirrored components, the
// harness's stand-ins for docs-only imports, and react, and it passes no
// consumer class whose upstream styling the mirror drops.
//
// The output is two trimmed copies of the example holding only the kept
// sub-examples, the top-level code they reach and the imports they use, with
// the kept sub-examples exported. The upstream copy keeps upstream's imports;
// ours points registry imports at this registry's components. Everything else
// is upstream's code as written.

import type {
  ExportDefaultDeclaration,
  Identifier,
  ImportDeclaration,
  Node,
  SourceLocation,
  Statement,
} from '@babel/types'
import MagicString from 'magic-string'
import { childNodes, parseModule, span } from './ast.ts'
import { registryModule } from './names.ts'

// Imports the harness provides stand-ins for (ab/stubs).
export const STUBBED = new Set(['components/example', '@/app/(create)/components/icon-placeholder'])

export type PreparedExample = {
  upstream: string
  ours: string
  kept: string[]
  // Why each other sub-example is skipped
  skipped: { name: string; reasons: string[] }[]
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
    for (const child of childNodes(current)) visit(child, current)
  }
  visit(node, undefined)
  return names
}

// Whitespace-separated tokens of every string in a node: the classes it may pass.
function classTokens(node: Node): string[] {
  const tokens: string[] = []
  const visit = (current: Node) => {
    if (current.type === 'StringLiteral') tokens.push(...current.value.split(/\s+/))
    if (current.type === 'TemplateElement') tokens.push(...current.value.raw.split(/\s+/))
    for (const child of childNodes(current)) visit(child)
  }
  visit(node)
  return tokens
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
  // Consumer classes whose upstream styling the mirror drops
  dropped: Set<string>,
  // Packages mirrored items depend on (recharts), which examples may import
  packages: Set<string> = new Set(),
): PreparedExample {
  const ast = parseModule(source)
  const registry = `@/registry/${style}/`
  const imports = new Map<string, ImportDeclaration>()
  const declarations = new Map<string, Statement>()
  let order: string[] = []
  // The default export's own function, which is the one sub-example when it
  // renders the whole page itself (sidebar-example).
  let whole: { name: string; statement: Statement } | undefined

  for (const statement of ast.program.body) {
    if (statement.type === 'ImportDeclaration') {
      for (const s of statement.specifiers) imports.set(s.local.name, statement)
    } else if (statement.type === 'ExportDefaultDeclaration') {
      const listed = references(statement.declaration)
      order = [...listed].filter((name) => /^[A-Z]/.test(name))
      const { declaration } = statement
      if (declaration.type === 'FunctionDeclaration' && declaration.id) {
        whole = { name: declaration.id.name, statement }
      }
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
  if (order.length === 0 && whole) {
    order = [whole.name]
    declarations.set(whole.name, whole.statement)
  }
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

  // What an import needs that the harness lacks, or undefined when it has it:
  // an unmirrored item by name, anything else by specifier.
  const unavailable = (from: string): string | undefined => {
    if (from === 'react' || packages.has(from)) return undefined
    const local = from.startsWith(registry) ? from.slice(registry.length) : from
    if (STUBBED.has(local)) return undefined
    if (!local.startsWith('ui/')) return from
    const item = local.slice(3)
    return mirrored.has(item) ? undefined : item
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
            const gap = unavailable((imports.get(ref) as ImportDeclaration).source.value)
            return gap === undefined ? [] : [gap]
          }),
      ),
    ].sort()
    const passed = [...reached]
      .filter((ref) => declarations.has(ref))
      .flatMap((ref) => classTokens(declarations.get(ref) as Node))
      .filter((token) => dropped.has(token))
    const reasons = [
      ...(missing.length > 0 ? [`needs ${missing.join(', ')}`] : []),
      ...[...new Set(passed)].sort().map((c) => `passes ${c}, whose styling the mirror drops`),
    ]
    if (reasons.length > 0) {
      skipped.push({ name, reasons })
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
          out.overwrite(...span(statement.source), JSON.stringify(registryModule(namespace, item)))
        }
      } else if (statement === whole?.statement && keep.has(whole.name)) {
        // Exported by name below with the other kept sub-examples.
        const { declaration } = statement as ExportDefaultDeclaration
        out.remove(statement.start as number, declaration.start as number)
      } else if (!declared(statement).some((name) => keep.has(name))) {
        remove(statement)
      }
    }
    out.append(`\nexport { ${kept.join(', ')} }\n`)
    return out.toString().replace(/\n{3,}/g, '\n\n')
  }

  return { upstream: trimmed(false), ours: trimmed(true), kept, skipped }
}
