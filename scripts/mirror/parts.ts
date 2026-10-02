// How each exported component renders in the generated tests and A/B
// fixtures. Many are parts that only render inside their item's other parts
// (a DialogTitle needs an open Dialog and its DialogContent), so each is
// scaffolded the way upstream's docs example first uses it: inside the same
// item's components that enclose it there, with the literal props the example
// passes. TypeScript reads upstream's own types for the rest: whether a part
// renders an element (takes className) and whether it opens (defaultOpen).

import { fileURLToPath } from 'node:url'
import type { JSXElement, Node } from '@babel/types'
import { Project, type Type, ts } from 'ts-morph'
import { childNodes, parseModule } from './ast.ts'
import type { PreparedComponent } from './component.ts'
import { pascalCase } from './names.ts'
import type { Literal, Part } from './shapes.ts'
import type { TransformedComponent } from './tsx.ts'

export type { Literal, Part } from './shapes.ts'

export type Usage = {
  // The same item's components it renders inside, outermost first
  ancestors: Part[]
  // Its own literal props from the example
  props: Record<string, Literal>
  // Whether it takes children: its type takes text, it does not render a void
  // element, <textarea> or table structure, and the example passes some
  children: boolean
}

export type Scaffold = Usage & {
  // Every other distinct way the example renders it, which reaches branches
  // of upstream's own logic (Slider's fallback when a controlled value is not
  // a literal)
  others: Usage[]
}

export type PartTypes = {
  // It renders an element and takes className (Dialog's Root does neither)
  className: boolean
  // It opens: rendered with defaultOpen, its popup shows
  opens: boolean
  // It can stay mounted while closed (Accordion's panel): rendered with
  // keepMounted, its element exists either way
  keepMounted: boolean
  // Props it requires (Progress's value)
  required: string[]
  // Its children prop: none at all; one that takes text; one that takes no
  // text but a function of each item (ComboboxCollection); or one that takes
  // neither (InputOTP's type rules text out)
  children: 'none' | 'text' | 'nodes' | 'function'
  // The values of each prop typed as a union of string literals
  // (MessageScrollerButton's direction: "start" | "end")
  options: Record<string, string[]>
}

// What one item's tests and fixtures know of its parts.
export type ItemParts = {
  types: Map<string, PartTypes>
  scaffolds: Map<string, Scaffold>
  // Parts of other mirrored items this module renders, by name
  external: Map<string, PartTypes>
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
  const checker = project.getTypeChecker().compilerObject
  const childrenKind = (children: Type | undefined): PartTypes['children'] => {
    if (children === undefined) return 'none'
    if (checker.isTypeAssignableTo(checker.getStringType(), children.compilerType)) return 'text'
    // Only a function: Dialog's root also takes one, but takes nodes too.
    const members = children.isUnion() ? children.getUnionTypes() : [children]
    return members.some((member) => member.getCallSignatures().length > 0) ? 'function' : 'nodes'
  }
  return new Map(
    files.map((file, i) => {
      const parts = new Map<string, PartTypes>()
      for (const [name, [declaration]] of file.getExportedDeclarations()) {
        const [param] = declaration?.getType().getCallSignatures()[0]?.getParameters() ?? []
        if (!declaration || !param || !/^[A-Z]/.test(name)) continue
        const type = param.getTypeAtLocation(declaration)
        const properties = type.getApparentProperties()
        const props = new Set(properties.map((p) => p.getName()))
        const options: Record<string, string[]> = {}
        for (const prop of properties) {
          const members = prop.getTypeAtLocation(declaration).getUnionTypes()
          const values = members.filter((m) => m.isStringLiteral()).map((m) => m.getLiteralValue())
          // Only unions of string literals, and undefined when optional.
          if (values.length > 1 && values.length >= members.length - 1) {
            options[prop.getName()] = values.map(String)
          }
        }
        parts.set(name, {
          className: props.has('className'),
          opens: props.has('defaultOpen'),
          keepMounted: props.has('keepMounted'),
          required: properties
            .filter((p) => !p.isOptional())
            .map((p) => p.getName())
            .sort(),
          children: childrenKind(type.getProperty('children')?.getTypeAtLocation(declaration)),
          options,
        })
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

// The name a top-level statement declares: a function, or a const.
function declaredName(statement: Node): string | undefined {
  const declaration =
    statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration'
      ? statement.declaration
      : statement
  if (declaration?.type === 'FunctionDeclaration') return declaration.id?.name
  if (declaration?.type === 'VariableDeclaration') {
    const [declarator] = declaration.declarations
    if (declarator?.id.type === 'Identifier') return declarator.id.name
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

// Elements that take no text: void elements, <textarea> (React rejects its
// children) and table structure, where text is invalid nesting.
const CHILDLESS = new Set([
  ...['area', 'br', 'col', 'embed', 'hr', 'img', 'input', 'textarea', 'wbr'],
  ...['table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup'],
])

// Each exported component's scaffold, from the first place the example
// renders it, or else inside the item's root component (a ProgressTrack in a
// Progress). `example` is the docs example's source, if upstream has one.
export function scaffolds(
  item: string,
  example: string | undefined,
  types: Map<string, PartTypes>,
  transformed: TransformedComponent,
  // Props some parts need that no example passes as a literal (a Toast's
  // toast object), by part
  given: Record<string, Record<string, Literal>> = {},
): Map<string, Scaffold> {
  const rendered = new Map(transformed.components.map((c) => [c.name, c]))
  const sets = new Map(transformed.variantSets.map((set) => [set.variable, set]))
  const root = [...types.keys()].find(
    (name) => name.toLowerCase() === pascalCase(item).toLowerCase(),
  )
  // A component's own cva() groups and prop defaults are its tests' and
  // fixtures' to vary.
  const omit = (name: string) => {
    const component = rendered.get(name)
    const set = sets.get(component?.variantSet ?? '')
    return new Set([
      ...OMIT,
      ...(set?.groups.map((group) => group.name) ?? []),
      ...(component?.defaults.map((d) => d.prop) ?? []),
    ])
  }
  // Every JSX element each source renders, with the top-level function it
  // is in: the example's, then the module's own (Toaster renders the toast
  // list, which renders each Toast).
  type Use = { path: JSXElement[]; owner?: string }
  const collect = (code: string) => {
    const uses = new Map<string, Use[]>()
    for (const statement of parseModule(code).program.body) {
      const owner = declaredName(statement)
      const visit = (node: Node, ancestors: JSXElement[]) => {
        let next = ancestors
        if (node.type === 'JSXElement') {
          const name = elementName(node)
          next = [...ancestors, node]
          // A part's own body renders its primitive, not itself.
          if (name && name !== owner) {
            uses.set(name, [...(uses.get(name) ?? []), { path: next, ...(owner ? { owner } : {}) }])
          }
          // JSX in a prop (content={<ChartTooltipContent />}) is not the
          // element's child: it keeps the element's own ancestors.
          visit(node.openingElement, ancestors)
          for (const child of node.children) visit(child, next)
          return
        }
        for (const child of childNodes(node)) visit(child, next)
      }
      visit(statement, [])
    }
    return uses
  }
  const sources = [...(example === undefined ? [] : [collect(example)]), collect(transformed.code)]
  // A component whose types are unknown (not an exported part) is taken to
  // take text.
  const takesText = (name: string) => (types.get(name)?.children ?? 'text') === 'text'
  // Where an element is first rendered: in the example if it is there.
  const firstUse = (name: string) =>
    sources.map((uses) => uses.get(name)?.[0]).find((use) => use !== undefined)
  // A path inside a component (the example's ListItem, the module's
  // DialogContent) continues from where that component is first rendered.
  // The owner encloses the path, for its context (Progress around the
  // ProgressTrack it renders), unless it takes no children (Calendar renders
  // CalendarDayButton through react-day-picker, not as a child).
  const extend = ({ path, owner }: Use, seen: Set<string>): JSXElement[] => {
    const use = owner === undefined || seen.has(owner) ? undefined : firstUse(owner)
    if (!use) return path
    const around = extend(use, new Set([...seen, owner as string]))
    const takesChildren = takesText(owner as string)
    return [...(takesChildren ? around : around.slice(0, -1)), ...path]
  }
  // Every place a part is rendered: the example's uses, or else the module's.
  const found = new Map<string, JSXElement[][]>()
  for (const name of types.keys()) {
    const uses = sources.map((source) => source.get(name) ?? []).find((list) => list.length > 0)
    if (uses)
      found.set(
        name,
        uses.map((use) => extend(use, new Set([name]))),
      )
  }
  // An ancestor that opens renders open, and one that can stay mounted while
  // closed (NavigationMenuContent) does, so the part inside it renders.
  const opened = (part: Part): Part => {
    const type = types.get(part.component)
    const { open: _, ...props } = part.props
    return {
      ...part,
      props: {
        ...(type?.opens ? props : part.props),
        ...(type?.opens ? { defaultOpen: true } : {}),
        ...(type?.keepMounted ? { keepMounted: true } : {}),
      },
    }
  }
  // The part a trigger opens: its first child that is the item's `*Trigger`.
  const triggerOf = (element: JSXElement): Part | undefined => {
    for (const child of element.children) {
      if (child.type !== 'JSXElement') continue
      const component = elementName(child)
      if (component && types.has(component) && component.endsWith('Trigger')) {
        return { component, props: literalProps(child) }
      }
    }
    return undefined
  }
  // The same item's parts enclosing a use of `name`, outermost first.
  const enclosing = (path: JSXElement[]): Part[] => {
    const last = path.at(-1)
    const own = last && elementName(last)
    return path.slice(0, -1).flatMap((ancestor) => {
      const component = elementName(ancestor)
      if (component === undefined || !types.has(component)) return []
      // Not when the trigger is the part being scaffolded, which would
      // render it twice.
      const found = types.get(component)?.opens ? triggerOf(ancestor) : undefined
      const trigger = found?.component === own ? undefined : found
      const props = { ...literalProps(ancestor), ...given[component] }
      return [{ component, props, ...(trigger ? { trigger } : {}) }]
    })
  }
  // Where a part the example never renders, nor another part uses, can
  // render: the deepest place the example renders any part, which has the
  // most of the item's context around it (NavigationMenuIndicator needs an
  // item). Else the item's root.
  const deepest = [...found.values()]
    .map((paths) => enclosing(paths[0] as JSXElement[]))
    .reduce<Part[]>((best, parts) => (parts.length > best.length ? parts : best), [])
  const chain = (name: string, path: JSXElement[] | undefined): Part[] => {
    if (path) return enclosing(path)
    if (deepest.length > 0 && !deepest.some((part) => part.component === name)) return deepest
    return root && root !== name ? [{ component: root, props: {} }] : []
  }

  // A use inside a helper component (a menu item a map renders) lacks the
  // parts above it: they come from where the example first renders its
  // outermost part, until the chain reaches the item's root.
  const complete = (name: string, ancestors: Part[], seen = new Set<string>()): Part[] => {
    const outer = ancestors[0]?.component ?? name
    if (outer === root || seen.has(outer)) return ancestors
    const prefix = chain(outer, found.get(outer)?.[0])
    return [...complete(outer, prefix, new Set([...seen, outer])), ...ancestors]
  }
  const usage = (name: string, path: JSXElement[] | undefined, skip: Set<string>): Usage => {
    const element = path?.at(-1)
    const type = types.get(name)
    const props = { ...(element ? literalProps(element, skip) : {}), ...given[name] }
    return {
      ancestors: complete(name, chain(name, path)).map(opened),
      // A part that opens itself renders open (CommandDialog), and one that
      // can stay mounted does.
      props: {
        ...props,
        ...(type?.opens && type.className ? { defaultOpen: true } : {}),
        ...(type?.keepMounted ? { keepMounted: true } : {}),
      },
      children:
        takesText(name) &&
        !CHILDLESS.has(rendered.get(name)?.tag ?? '') &&
        (element ? hasChildren(element) : true),
    }
  }
  return new Map(
    [...types.keys()].map((name) => {
      const [first, ...rest] = found.get(name) ?? []
      const scaffold = usage(name, first, omit(name))
      // The others keep the variant and default props the first leaves to
      // the tests that vary them.
      const seen = new Set([JSON.stringify(usage(name, first, OMIT))])
      // A part whose children are a function of each item (ComboboxCollection)
      // cannot hold another part's element: those uses are left out, and the
      // first leaves it out of its chain.
      const holdsElements = (part: Part) => types.get(part.component)?.children !== 'function'
      const others = rest
        .map((path) => usage(name, path, OMIT))
        .filter((other) => other.ancestors.every(holdsElements))
        .filter((other) => {
          const key = JSON.stringify(other)
          return !seen.has(key) && seen.add(key)
        })
      const ancestors = scaffold.ancestors.filter(holdsElements)
      return [name, { ...scaffold, ancestors, others }]
    }),
  )
}
