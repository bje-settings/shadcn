// How each exported component renders in the generated tests and A/B
// fixtures. Many are parts that only render inside their item's other parts
// (a DialogTitle needs an open Dialog and its DialogContent), so each is
// scaffolded the way upstream's docs example first uses it: inside the same
// item's components that enclose it there, with the literal props the example
// passes. TypeScript reads upstream's own types for the rest: whether a part
// renders an element (takes className) and whether it opens (defaultOpen).

import { fileURLToPath } from 'node:url'
import type { JSXElement, Node } from '@babel/types'
import { Project, ts } from 'ts-morph'
import { childNodes, parseModule } from './ast.ts'
import type { PreparedComponent } from './component.ts'
import type { TransformedComponent } from './tsx.ts'

export type Literal = string | number | boolean | Literal[] | { [key: string]: Literal }

export type Part = { component: string; props: Record<string, Literal> }

export type Scaffold = {
  // The same item's components it renders inside, outermost first
  ancestors: Part[]
  // Its own literal props from the example
  props: Record<string, Literal>
  // Whether it takes children: the example passes some, or else it does not
  // render a void element
  children: boolean
}

export type PartTypes = {
  // It renders an element and takes className (Dialog's Root does neither)
  className: boolean
  // It opens: rendered with defaultOpen, its popup shows
  opens: boolean
}

// This repo's root: upstream's imports resolve against its node_modules
// wherever the build writes.
const repo = fileURLToPath(new URL('../..', import.meta.url))

// Types for every exported component of every prepared item, from upstream's
// installed source with its own imports resolved.
export function partTypes(
  style: string,
  components: PreparedComponent[],
): Map<string, Map<string, PartTypes>> {
  const project = new Project({
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.Preserve,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      baseUrl: repo,
      paths: { [`@/registry/${style}/ui/*`]: ['.mirror-types/*'] },
    },
    skipAddingFilesFromTsConfig: true,
  })
  const files = components.map(({ upstream, installed }) =>
    project.createSourceFile(`${repo}.mirror-types/${upstream.name}.tsx`, installed, {
      overwrite: true,
    }),
  )
  return new Map(
    files.map((file, i) => {
      const parts = new Map<string, PartTypes>()
      for (const [name, [declaration]] of file.getExportedDeclarations()) {
        const [param] = declaration?.getType().getCallSignatures()[0]?.getParameters() ?? []
        if (!declaration || !param || !/^[A-Z]/.test(name)) continue
        const props = new Set(
          param
            .getTypeAtLocation(declaration)
            .getApparentProperties()
            .map((p) => p.getName()),
        )
        parts.set(name, { className: props.has('className'), opens: props.has('defaultOpen') })
      }
      return [(components[i] as PreparedComponent).upstream.name, parts]
    }),
  )
}

// A JSX attribute's value, when it is a literal the scaffold can repeat.
function literal(node: Node | null | undefined): Literal | undefined {
  if (node === null || node === undefined) return true
  if (node.type === 'JSXExpressionContainer') return literal(node.expression)
  if (node.type === 'StringLiteral' || node.type === 'NumericLiteral') return node.value
  if (node.type === 'BooleanLiteral') return node.value
  if (node.type === 'ArrayExpression') {
    const items = node.elements.map((element) => (element ? literal(element) : undefined))
    return items.every((item) => item !== undefined) ? (items as Literal[]) : undefined
  }
  if (node.type === 'ObjectExpression') {
    const entries = node.properties.map((property) =>
      property.type === 'ObjectProperty' &&
      !property.computed &&
      (property.key.type === 'Identifier' || property.key.type === 'StringLiteral')
        ? ([
            property.key.type === 'Identifier' ? property.key.name : property.key.value,
            literal(property.value),
          ] as const)
        : undefined,
    )
    return entries.every((entry) => entry?.[1] !== undefined)
      ? Object.fromEntries(entries as [string, Literal][])
      : undefined
  }
  return undefined
}

function elementName(element: JSXElement): string | undefined {
  const { name } = element.openingElement
  return name.type === 'JSXIdentifier' ? name.name : undefined
}

// Props the scaffold never repeats: the example's Tailwind classes and
// styles, and what the tests and fixtures vary themselves.
const OMIT = new Set(['className', 'style', 'disabled', 'children', 'key'])

function literalProps(element: JSXElement, omit: Set<string> = OMIT): Record<string, Literal> {
  const props: Record<string, Literal> = {}
  for (const attribute of element.openingElement.attributes) {
    if (attribute.type !== 'JSXAttribute' || attribute.name.type !== 'JSXIdentifier') continue
    const value = literal(attribute.value)
    if (value !== undefined && !omit.has(attribute.name.name)) props[attribute.name.name] = value
  }
  return props
}

function hasChildren(element: JSXElement): boolean {
  return element.children.some((child) => child.type !== 'JSXText' || child.value.trim() !== '')
}

// Void elements render no children; React rejects them on <textarea>.
const CHILDLESS = new Set(['area', 'br', 'col', 'embed', 'hr', 'img', 'input', 'textarea', 'wbr'])

// Each exported component's scaffold, from the first place the example
// renders it. `example` is the docs example's source, if upstream has one.
export function scaffolds(
  example: string | undefined,
  types: Map<string, PartTypes>,
  transformed: TransformedComponent,
): Map<string, Scaffold> {
  const rendered = new Map(transformed.components.map((c) => [c.name, c]))
  const sets = new Map(transformed.variantSets.map((set) => [set.variable, set]))
  // A component's own cva() groups are the fixtures' to vary.
  const omit = (name: string) => {
    const set = sets.get(rendered.get(name)?.variantSet ?? '')
    return new Set([...OMIT, ...(set?.groups.map((group) => group.name) ?? [])])
  }
  const found = new Map<string, JSXElement[]>()
  if (example !== undefined) {
    const visit = (node: Node, ancestors: JSXElement[]) => {
      const name = node.type === 'JSXElement' ? elementName(node) : undefined
      if (name && types.has(name) && !found.has(name))
        found.set(name, [...ancestors, node as JSXElement])
      const next = node.type === 'JSXElement' ? [...ancestors, node] : ancestors
      for (const child of childNodes(node)) visit(child, next)
    }
    visit(parseModule(example).program, [])
  }
  const opened = (part: Part): Part => {
    if (!types.get(part.component)?.opens) return part
    const { open: _, ...props } = part.props
    return { component: part.component, props: { ...props, defaultOpen: true } }
  }
  return new Map(
    [...types.keys()].map((name) => {
      const path = found.get(name)
      const element = path?.at(-1)
      const ancestors = (path?.slice(0, -1) ?? [])
        .filter((ancestor) => types.has(elementName(ancestor) ?? ''))
        .map((ancestor) =>
          opened({ component: elementName(ancestor) as string, props: literalProps(ancestor) }),
        )
      return [
        name,
        {
          ancestors,
          props: element ? literalProps(element, omit(name)) : {},
          children: element ? hasChildren(element) : !CHILDLESS.has(rendered.get(name)?.tag ?? ''),
        },
      ]
    }),
  )
}
