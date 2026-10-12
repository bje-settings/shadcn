// Turns an upstream `<item>-example` (the demo behind shadcn's docs page) into
// A/B cases: each sub-example the default export renders becomes a case when
// everything it reaches is available, which is mirrored components, the
// harness's stand-ins for docs-only imports, react and the packages the
// caller allows (mirrored items' dependencies, and preview.packages for
// /create preview cards), and it passes no registry component a consumer
// class its item's upstream styling gates on and the mirror drops (border-b
// on a CardHeader, not on a TabsList). A module with no default
// export (a /create preview card) has its exported PascalCase functions as
// its sub-examples.
//
// The output is two trimmed copies of the example holding only the kept
// sub-examples, the top-level code they reach and the imports they use, with
// the kept sub-examples exported. The upstream copy keeps upstream's imports;
// ours points registry imports at this registry's components. Everything else
// is upstream's code as written.

import type {
  Declaration,
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

// The /create internals the preview cards read the design system from, and
// the stub (in ab/stubs) that returns the configured theme for each.
// ab/tsconfig.json maps the same.
export const CREATE_STUBS: Record<string, string> = {
  '@/app/(create)/lib/fonts': 'ab/stubs/fonts.ts',
  '@/app/(create)/lib/search-params': 'ab/stubs/search-params.ts',
  '@/app/(app)/create/lib/search-params': 'ab/stubs/search-params.ts',
  '@/registry/styles': 'ab/stubs/styles.ts',
}

// Imports the harness provides stand-ins for (ab/stubs).
export const STUBBED = new Set([
  'components/example',
  '@/app/(create)/components/icon-placeholder',
  'next/image',
  'next/link',
  ...Object.keys(CREATE_STUBS),
])

// Sub-examples that would render but differ from upstream for a reason the
// mirror does not handle yet, skipped by name in every style, with why.
// NavigationMenuBasic passes navigationMenuTriggerStyle() to NavigationMenuLink:
// tailwind-merge lets the trigger's horizontal padding override the link's,
// while the mirror's :where() rules resolve by source order and keep the
// link's. In vega (px-4 against p-2) the link is 16px narrower; in rhea the two
// paddings match.
export const KNOWN_DIFFERENCES = new Map([
  [
    'NavigationMenuBasic',
    "passes navigationMenuTriggerStyle() to NavigationMenuLink, whose padding tailwind-merge overrides and the mirror's :where() rules do not",
  ],
])

export type PreparedExample = {
  upstream: string
  ours: string
  kept: string[]
  // Why each other sub-example is skipped
  skipped: { name: string; reasons: string[] }[]
}

// Names a statement declares at the top level, exported or not. A top-level
// function declaration always has a name; only `export default function` may
// not.
function declared(statement: Statement): string[] {
  if (statement.type === 'ExportNamedDeclaration' && statement.declaration) {
    return declared(statement.declaration)
  }
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
function stringTokens(node: Node): string[] {
  const tokens: string[] = []
  const visit = (current: Node) => {
    if (current.type === 'StringLiteral') tokens.push(...current.value.split(/\s+/))
    if (current.type === 'TemplateElement') tokens.push(...current.value.raw.split(/\s+/))
    for (const child of childNodes(current)) visit(child)
  }
  visit(node)
  return tokens
}

// The gated classes a node passes as className to a registry component:
// `components` maps the local name of each registry import to the consumer
// classes its item's upstream styling gates on.
function componentClassTokens(node: Node, components: Map<string, Set<string>>): string[] {
  const tokens: string[] = []
  const visit = (current: Node) => {
    if (current.type === 'JSXOpeningElement') {
      const { name } = current
      const tag =
        name.type === 'JSXIdentifier'
          ? name.name
          : name.type === 'JSXMemberExpression' && name.object.type === 'JSXIdentifier'
            ? name.object.name
            : undefined
      for (const attribute of current.attributes) {
        if (
          tag !== undefined &&
          components.has(tag) &&
          attribute.type === 'JSXAttribute' &&
          attribute.name.name === 'className' &&
          attribute.value
        ) {
          const gated = components.get(tag) as Set<string>
          tokens.push(...stringTokens(attribute.value).filter((token) => gated.has(token)))
        }
      }
    }
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
  // Consumer classes whose upstream styling the mirror drops, by the item
  // whose module drops it (card: border-b, border-t)
  dropped: Map<string, Set<string>>,
  // Packages mirrored items depend on (recharts), which examples may import
  packages: Set<string> = new Set(),
): PreparedExample {
  const ast = parseModule(source)
  const registry = `@/registry/${style}/`
  const imports = new Map<string, ImportDeclaration>()
  const declarations = new Map<string, Statement>()
  let order: string[] = []
  // Exported functions: the sub-examples of a module with no default export
  // (a /create preview card).
  const exported: string[] = []
  // The default export's own function, which is the one sub-example when it
  // renders the whole page itself (sidebar-example).
  let whole: { name: string; statement: Statement } | undefined
  let hasDefault = false

  for (const statement of ast.program.body) {
    if (statement.type === 'ImportDeclaration') {
      for (const s of statement.specifiers) imports.set(s.local.name, statement)
    } else if (statement.type === 'ExportDefaultDeclaration') {
      hasDefault = true
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
      if (
        statement.type === 'ExportNamedDeclaration' &&
        statement.declaration?.type === 'FunctionDeclaration'
      ) {
        exported.push(...names)
      }
    }
  }
  order = order.filter((name) => declarations.has(name))
  if (order.length === 0 && whole) {
    order = [whole.name]
    declarations.set(whole.name, whole.statement)
  }
  if (!hasDefault) {
    order = exported.filter((name) => /^[A-Z]/.test(name))
    if (order.length === 0) {
      throw new Error('example: no default export, and no exported sub-example functions')
    }
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

  // Local names of registry component imports whose item drops rules a
  // consumer class gates, and those classes.
  const gatedComponents = new Map(
    [...imports].flatMap(([name, declaration]) => {
      const from = declaration.source.value
      const gated = from.startsWith(`${registry}ui/`)
        ? dropped.get(from.slice(`${registry}ui/`.length))
        : undefined
      return gated === undefined ? [] : [[name, gated] as const]
    }),
  )

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
      .flatMap((ref) => componentClassTokens(declarations.get(ref) as Node, gatedComponents))
    const reasons = [
      ...(missing.length > 0 ? [`needs ${missing.join(', ')}`] : []),
      ...(KNOWN_DIFFERENCES.has(name) ? [KNOWN_DIFFERENCES.get(name) as string] : []),
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
      } else if (statement.type === 'ExportNamedDeclaration') {
        // Exported by name below, if it is a kept sub-example.
        const { declaration } = statement
        out.remove(statement.start as number, (declaration as Declaration).start as number)
      }
    }
    out.append(`\nexport { ${kept.join(', ')} }\n`)
    return out.toString().replace(/\n{3,}/g, '\n\n')
  }

  return { upstream: trimmed(false), ours: trimmed(true), kept, skipped }
}
