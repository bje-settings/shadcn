// Rewrites an upstream component so its Tailwind classes move into a CSS
// module. Edits are applied in place with magic-string, leaving everything
// the mirror does not need to touch byte-for-byte as upstream wrote it.
//
// Supported class sources (anything else fails loudly with its position):
// - `const xVariants = cva(base, { variants, defaultVariants })`: replaced by
//   a lookup object and a same-named function with cva's call signature, so
//   `xVariants({ variant, size, className })` and `VariantProps<typeof
//   xVariants>` call sites keep working.
// - `className="..."` and `cn("...", ...)` on an element, named from its
//   `data-slot` (or a Base UI `useRender()`'s `state.slot`), else from its
//   component and tag; a `fooClassName` prop; a keyed `classNames={{ day }}`.
// - String literals and `String.raw` templates; each branch of a conditional
//   or `&&`, and each key of clsx's object form, as its own class.
// - `cn(xVariants(...))`.

import type {
  ArrowFunctionExpression,
  CallExpression,
  FunctionDeclaration,
  FunctionExpression,
  Identifier,
  JSXOpeningElement,
  Node,
  ObjectExpression,
  SourceLocation,
  StringLiteral,
  VariableDeclaration,
} from '@babel/types'
import MagicString from 'magic-string'
import { childNodes, parseModule, span } from './ast.ts'
import { camelCase, pascalCase, registryModule } from './names.ts'
import { MARKER, NAMED_TEXT_SIZE, SIZE_ATTRIBUTE, SIZE_PROBE, type Slot } from './scss.ts'

// ClassValue types the className of generated cva() replacements, matching
// cva's own type, which also accepts (and clsx ignores) Base UI's function
// form of className.
function clsxImport(withClassValue: boolean): string {
  return `import { ${withClassValue ? 'type ClassValue, ' : ''}clsx } from "clsx"`
}

// What the test generator needs to know about one cva() call.
export type VariantSet = {
  // The generated function, e.g. buttonVariants
  variable: string
  // Module class of the base slot
  base: string
  groups: {
    name: string
    default?: string
    // An option with no classes (Marker's default) has no slot
    options: { value: string; slot?: string }[]
  }[]
}

// A top-level component function and the element whose classes it sets.
export type RenderedComponent = {
  name: string
  // Raw data-slot of that element (a JSX attribute or useRender's state.slot),
  // if it renders one (InputGroupText's span does not)
  dataSlot?: string
  // Its JSX tag (`input`, `ButtonPrimitive`, `Primitive.Root`'s `Root`), if
  // it is a JSX element
  tag?: string
  // Module class for the component's own class strings
  slot?: string
  // cva() variable whose classes it applies
  variantSet?: string
  // Destructured props with a literal default, as source text
  defaults: { prop: string; value: string }[]
  // The error it throws outside its root, from a hook of this module it
  // calls (DrawerContent's useDrawer)
  throwsOutside?: string
  // It renders default content without children (`children ?? "Next"`)
  defaultChildren?: true
  // Its own element's class in each of its render branches, when they
  // differ (Sidebar's collapsible, mobile and desktop branches)
  branches?: string[]
}

// A hook the module declares, and the error it throws, if it throws one
// (outside its provider).
export type Hook = { name: string; throws?: string }

// A group or peer marker class (`group/card`) and where it sits: the module
// class of its element and the data-slot values that element renders.
export type Marker = {
  marker: string
  slot: string
  dataSlots: string[]
}

export type TransformedComponent = {
  code: string
  slots: Slot[]
  hooks: Hook[]
  // Raw data-slot values each module class lands on
  dataSlots: Record<string, string[]>
  // Module classes on an element that has no data-slot and carries the
  // size-class probe's attribute
  sized: string[]
  markers: Marker[]
  variantSets: VariantSet[]
  components: RenderedComponent[]
  // Other upstream items this one imports, by item name
  registryImports: string[]
}

// Babel sets loc on every node it parses.
function unsupported(node: Node, message: string): never {
  const { line, column } = (node.loc as SourceLocation).start
  throw new Error(`Unsupported at ${line}:${column + 1}: ${message}`)
}

// visit returns false to skip the node's children.
function walk(
  node: Node,
  visit: (node: Node, ancestors: Node[]) => boolean,
  ancestors: Node[] = [],
): void {
  if (!visit(node, ancestors)) return
  const next = [...ancestors, node]
  for (const child of childNodes(node)) walk(child, visit, next)
}

type NamedCall = CallExpression & { callee: Identifier }

// A call to a plain identifier (`cn(...)`, `buttonVariants(...)`), optionally
// a specific one.
function isCallTo(node: Node | null | undefined, name?: string): node is NamedCall {
  return (
    node?.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    (name === undefined || node.callee.name === name)
  )
}

// shadcn's `cn-*` classes are style hooks the CLI resolves or strips on
// install; any left after its transforms carry no CSS in a consumer project.
const STYLE_HOOK = /^cn-[a-z-]+$/

function classList(literal: StringLiteral): string[] {
  return classesOf(literal.value)
}

function classesOf(value: string): string[] {
  return value.split(/\s+/).filter((c) => c !== '' && !STYLE_HOOK.test(c))
}

// A class string written as String.raw`...` with no substitutions (Calendar
// escapes underscores in arbitrary variants that way), or a plain literal.
function staticClasses(node: Node): string[] | undefined {
  if (node.type === 'StringLiteral') return classList(node)
  if (
    node.type === 'TaggedTemplateExpression' &&
    node.tag.type === 'MemberExpression' &&
    node.tag.object.type === 'Identifier' &&
    node.tag.object.name === 'String' &&
    node.tag.property.type === 'Identifier' &&
    node.tag.property.name === 'raw' &&
    node.quasi.expressions.length === 0
  ) {
    return classesOf(node.quasi.quasis.map((quasi) => quasi.value.raw).join(''))
  }
  return undefined
}

function objectEntries(object: Node): [string, Node][] {
  if (object.type !== 'ObjectExpression') unsupported(object, 'expected an object literal')
  return (object as ObjectExpression).properties.map((property) => {
    if (property.type !== 'ObjectProperty' || property.computed) {
      unsupported(property, 'object member other than a plain key: value')
    }
    const { key } = property
    if (key.type === 'Identifier') return [key.name, property.value]
    if (key.type === 'StringLiteral') return [key.value, property.value]
    return unsupported(key, `object key ${key.type}`)
  })
}

function stringValue(node: Node): StringLiteral {
  if (node.type !== 'StringLiteral') {
    unsupported(node, `expected a string literal, got ${node.type}`)
  }
  return node
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

function key(name: string): string {
  return IDENTIFIER.test(name) ? name : JSON.stringify(name)
}

type Cva = {
  typeName: string
  slots: Slot[]
  code: string
  set: VariantSet
}

const ARBITRARY_TEXT_SIZE = /^text-\[\d*\.?\d+(rem|em|px)\]$/

// Whether a variant option's arbitrary font size replaces the base's named
// one, which tailwind-merge removes with its line-height (unless the option
// sets its own).
function resetsLeading(base: string[], option: string[]): boolean {
  return (
    base.some((c) => NAMED_TEXT_SIZE.test(c)) &&
    option.some((c) => ARBITRARY_TEXT_SIZE.test(c)) &&
    !option.some((c) => c.startsWith('leading-'))
  )
}

function convertCva(
  declaration: VariableDeclaration,
  call: CallExpression,
  variable: string,
  component: string,
): Cva {
  if (declaration.declarations.length !== 1) {
    unsupported(declaration, 'cva() in a multi-variable declaration')
  }
  const [baseArg, configArg, ...rest] = call.arguments
  if (!baseArg || rest.length > 0) unsupported(call, 'cva() takes a base and an optional config')
  const prefix = variable.replace(/Variants$/, '')
  const short = prefix === camelCase(component)
  const typeName = `${pascalCase(prefix)}VariantProps`
  const classesName = `${prefix}VariantClasses`
  const baseClasses = classList(stringValue(baseArg))
  const slots: Slot[] = [{ name: prefix, classes: baseClasses }]

  const config = new Map(configArg ? objectEntries(configArg) : [])
  for (const name of config.keys()) {
    if (name !== 'variants' && name !== 'defaultVariants') unsupported(call, `cva ${name}`)
  }
  const entriesOf = (name: string) => {
    const value = config.get(name)
    return value ? objectEntries(value) : []
  }
  const variants = entriesOf('variants')
  const defaults = new Map(
    entriesOf('defaultVariants').map(([group, value]) => [group, stringValue(value).value]),
  )

  const groups = variants.map(([group, options]) => {
    // Group names become prop and parameter names.
    if (!IDENTIFIER.test(group)) unsupported(options, `cva variant group ${JSON.stringify(group)}`)
    const choices = objectEntries(options).map(([option, value]) => {
      const classes = classList(stringValue(value))
      if (classes.length === 0) return { value: option }
      const name = `${short ? group : `${prefix}${pascalCase(group)}`}${pascalCase(option)}`
      slots.push({
        name,
        classes,
        ...(resetsLeading(baseClasses, classes) ? { resetsLeading: true } : {}),
      })
      return { value: option, slot: name }
    })
    const lines = choices.map(({ value, slot }) =>
      slot ? `    ${key(value)}: styles.${slot},` : `    ${key(value)}: undefined,`,
    )
    return { group, choices, lines: [`  ${group}: {`, ...lines, '  },'] }
  })
  for (const [group, value] of defaults) {
    const choices = groups.find((g) => g.group === group)?.choices ?? []
    if (!choices.some((choice) => choice.value === value)) {
      unsupported(call, `defaultVariants ${group}=${JSON.stringify(value)} is not a variant option`)
    }
  }

  const params = groups.map(({ group }) =>
    defaults.has(group) ? `  ${group} = ${JSON.stringify(defaults.get(group))},` : `  ${group},`,
  )
  const picks = groups.map(({ group }) => `    ${group} && ${classesName}.${group}[${group}],`)

  const code = [
    `const ${classesName} = {`,
    ...groups.flatMap(({ lines }) => lines),
    '} as const',
    '',
    `type ${typeName} = {`,
    `  [Group in keyof typeof ${classesName}]?: keyof (typeof ${classesName})[Group] | null`,
    '}',
    '',
    `function ${variable}({`,
    ...params,
    '  className,',
    `}: ${typeName} & { className?: ClassValue } = {}) {`,
    '  return clsx(',
    `    styles.${prefix},`,
    ...picks,
    '    className',
    '  )',
    '}',
  ].join('\n')

  const set: VariantSet = {
    variable,
    base: prefix,
    groups: groups.map(({ group, choices }) => ({
      name: group,
      ...(defaults.has(group) ? { default: defaults.get(group) } : {}),
      options: choices,
    })),
  }
  return { typeName, slots, code, set }
}

// The raw data-slot the classes land on: the nearest enclosing JSX element's
// data-slot attribute, or else the `state.slot` of an enclosing Base UI
// useRender() call, which renders it as data-slot.
function dataSlot(ancestors: Node[]): string | undefined {
  const opening = ancestors.findLast((node) => node.type === 'JSXOpeningElement')
  if (opening?.type === 'JSXOpeningElement') {
    for (const attribute of opening.attributes) {
      if (
        attribute.type === 'JSXAttribute' &&
        attribute.name.name === 'data-slot' &&
        attribute.value?.type === 'StringLiteral'
      ) {
        return attribute.value.value
      }
    }
    return undefined
  }
  const render = ancestors.findLast((node) => isCallTo(node, 'useRender'))
  // A class string inside useRender() is inside its options argument.
  if (render?.type !== 'CallExpression') return undefined
  const options = render.arguments[0] as Node
  const state = objectEntries(options).find(([name]) => name === 'state')?.[1]
  const slot = state ? objectEntries(state).find(([name]) => name === 'slot')?.[1] : undefined
  return slot ? stringValue(slot).value : undefined
}

// A function component or hook, declared or assigned to a const.
type Fn = FunctionDeclaration | ArrowFunctionExpression | FunctionExpression

// The function a top-level statement declares, with its name: `function X()`
// or `const X = () => ...` (Sonner's Toaster), exported or not.
function topLevelFunction(statement: Node | undefined): { name: string; fn: Fn } | undefined {
  const node = statement?.type === 'ExportNamedDeclaration' ? statement.declaration : statement
  if (node?.type === 'FunctionDeclaration' && node.id) return { name: node.id.name, fn: node }
  if (node?.type !== 'VariableDeclaration' || node.declarations.length !== 1) return undefined
  const [declarator] = node.declarations
  const init = declarator?.init
  if (
    declarator?.id.type === 'Identifier' &&
    (init?.type === 'ArrowFunctionExpression' || init?.type === 'FunctionExpression')
  ) {
    return { name: declarator.id.name, fn: init }
  }
  return undefined
}

function literalDefaults(fn: Fn, source: string): RenderedComponent['defaults'] {
  const [param] = fn.params
  if (param?.type !== 'ObjectPattern') return []
  return param.properties.flatMap((property) => {
    if (
      property.type === 'ObjectProperty' &&
      property.key.type === 'Identifier' &&
      property.value.type === 'AssignmentPattern' &&
      ['StringLiteral', 'NumericLiteral', 'BooleanLiteral'].includes(property.value.right.type)
    ) {
      return [
        {
          prop: property.key.name,
          value: source.slice(...span(property.value.right)),
        },
      ]
    }
    return []
  })
}

// The top-level function or variable a node sits in.
function ownerName(ancestors: Node[]): string | undefined {
  const [, top] = ancestors
  const statement = top?.type === 'ExportNamedDeclaration' ? top.declaration : top
  if (statement?.type === 'FunctionDeclaration') return statement.id?.name
  if (statement?.type === 'VariableDeclaration') {
    const [declarator] = statement.declarations
    if (declarator?.id.type === 'Identifier') return declarator.id.name
  }
  return undefined
}

function tagName(ancestors: Node[]): string | undefined {
  const opening = ancestors.findLast((node) => node.type === 'JSXOpeningElement')
  if (opening?.type !== 'JSXOpeningElement') return undefined
  const { name } = opening
  if (name.type === 'JSXIdentifier') return name.name
  if (name.type === 'JSXMemberExpression') return name.property.name
  return undefined
}

// The key of a class string for a keyed part of a component, like
// react-day-picker's `classNames={{ day: cn(...) }}`: that part is named from
// the owner and the key, and is not the component's own element.
function keyedPart(ancestors: Node[]): string | undefined {
  const attribute = ancestors.findLast((node) => node.type === 'JSXAttribute')
  if (attribute?.type !== 'JSXAttribute' || attribute.name.name === 'className') return undefined
  const property = ancestors
    .slice(ancestors.indexOf(attribute) + 1)
    .find((node) => node.type === 'ObjectProperty')
  if (property?.type !== 'ObjectProperty') return undefined
  const { key } = property
  if (key.type === 'Identifier') return key.name
  if (key.type === 'StringLiteral' || key.type === 'NumericLiteral') return String(key.value)
  return unsupported(key, `class string under a ${key.type} key`)
}

// The module class for a class string: under a keyed prop (`classNames={{
// day }}`), the owner plus the key; else its element's data-slot, or, on an
// element without one, the enclosing top-level declaration and the element's
// tag (`accordionTriggerHeader` for `<AccordionPrimitive.Header>` in
// AccordionTrigger). A class string in a `fooClassName` prop adds `Foo`.
function slotName(ancestors: Node[]): string | undefined {
  const attribute = ancestors.findLast((node) => node.type === 'JSXAttribute')
  const prop =
    attribute?.type === 'JSXAttribute' && attribute.name.type === 'JSXIdentifier'
      ? attribute.name.name
      : 'className'
  const suffix = prop.endsWith('ClassName') ? pascalCase(prop.replace(/ClassName$/, '')) : ''
  const key = keyedPart(ancestors)
  if (key !== undefined) {
    const owner = ownerName(ancestors)
    return owner === undefined ? undefined : camelCase(owner) + pascalCase(key)
  }
  const slot = dataSlot(ancestors)
  if (slot !== undefined) return camelCase(slot) + suffix
  const owner = ownerName(ancestors)
  const tag = tagName(ancestors)
  if (owner === undefined || tag === undefined) return undefined
  return camelCase(owner) + pascalCase(tag) + suffix
}

// A name for each branch of a conditional class: `cond ? "a" : "b"` on slot
// `x` gives `xCond` and `xNotCond`, `mode === "y" ? ...` gives `xY` and
// `xNotY`, `a || b` gives `xAOrB`, and `cond && "a"` gives `xCond`.
function conditionName(test: Node): string {
  if (test.type === 'Identifier') return pascalCase(test.name)
  if (
    test.type === 'BinaryExpression' &&
    test.operator === '===' &&
    test.right.type === 'StringLiteral'
  ) {
    return pascalCase(test.right.value)
  }
  if (test.type === 'MemberExpression' && test.property.type === 'Identifier') {
    return pascalCase(test.property.name)
  }
  // `variant === "floating" || variant === "inset"` gives FloatingOrInset.
  if (test.type === 'LogicalExpression' && test.operator !== '??') {
    const joiner = test.operator === '||' ? 'Or' : 'And'
    return `${conditionName(test.left)}${joiner}${conditionName(test.right)}`
  }
  return unsupported(test, `class condition ${test.type}`)
}

// Whether an element takes the function's remaining props: `{...props}` of
// its rest parameter, or of its only parameter.
function spreadsProps(element: Node, fn: Fn): boolean {
  const [param] = fn.params
  const rest =
    param?.type === 'ObjectPattern'
      ? param.properties.find((p) => p.type === 'RestElement')?.argument
      : param
  if (rest?.type !== 'Identifier' || element.type !== 'JSXOpeningElement') return false
  return element.attributes.some(
    (a) =>
      a.type === 'JSXSpreadAttribute' &&
      a.argument.type === 'Identifier' &&
      a.argument.name === rest.name,
  )
}

// Whether a class expression forwards the component's className prop:
// `className`, `cn(..., className)` or `xVariants({ className })`.
function passesClassName(node: Node): boolean {
  if (node.type === 'Identifier') return node.name === 'className'
  if (node.type === 'CallExpression') return node.arguments.some(passesClassName)
  if (node.type === 'ObjectExpression') {
    return node.properties.some(
      (p) =>
        p.type === 'ObjectProperty' && p.key.type === 'Identifier' && p.key.name === 'className',
    )
  }
  return false
}

// Removes one argument of a call with the separator next to it.
function removeArgument(out: MagicString, call: CallExpression, arg: Node): void {
  const index = call.arguments.indexOf(arg as CallExpression['arguments'][number])
  const previous = call.arguments[index - 1]
  const next = call.arguments[index + 1]
  if (previous) out.remove(previous.end as number, arg.end as number)
  else if (next) out.remove(arg.start as number, next.start as number)
  else out.remove(...span(arg))
}

const REGISTRY_IMPORT = /^@\/registry\/[^/]+\/(ui|hooks)\/([a-z0-9-]+)$/

export function transformComponent(
  source: string,
  component: string,
  namespace: string,
): TransformedComponent {
  const ast = parseModule(source)
  const out = new MagicString(source)
  const cvas = new Map<string, Cva>()
  const slots: Slot[] = []
  const components = new Map<string, RenderedComponent>()
  const registryImports: string[] = []
  let usesClsx = false
  let cnImport: [number, number] | undefined
  let lastImportEnd = 0
  // cva() calls pass 1 converted, and top-level constants holding a string.
  const converted = new Set<Node>()
  const constants = new Set<string>()

  // Records, per top-level component function, its own element: the one it
  // spreads its remaining props onto, or else the one given the consumer's
  // className, or else the first it renders (Table's container comes before
  // the table). Elements are told apart by node, since not all render a
  // data-slot.
  const elements = new Map<string, { element: Node; rank: number }>()
  const track = (
    ancestors: Node[],
    update: Pick<RenderedComponent, 'slot' | 'variantSet'>,
    consumer: boolean,
  ) => {
    const owner = topLevelFunction(ancestors[1])
    // A JSX element, or a Base UI useRender() call rendering one.
    const element = ancestors.findLast(
      (node) => node.type === 'JSXOpeningElement' || isCallTo(node, 'useRender'),
    )
    if (!owner || !element) return
    const { name, fn } = owner
    const rank = spreadsProps(element, fn) ? 2 : consumer ? 1 : 0
    const bound = elements.get(name)
    const record = components.get(name)
    // Another branch's element with the same data-slot (the test finds its
    // data-slot around the element given the consumer's props).
    if (
      bound &&
      record &&
      bound.element !== element &&
      update.slot !== undefined &&
      dataSlot(ancestors) === record.dataSlot &&
      record.slot !== undefined &&
      record.slot !== update.slot
    ) {
      record.branches = [...new Set([...(record.branches ?? [record.slot]), update.slot])]
      return
    }
    if (bound?.element === element) {
      bound.rank = Math.max(bound.rank, rank)
      Object.assign(components.get(name) as RenderedComponent, update)
    } else if (!bound || rank > bound.rank) {
      const slot = dataSlot(ancestors)
      const tag = tagName(ancestors)
      components.set(name, {
        name,
        ...(slot !== undefined ? { dataSlot: slot } : {}),
        ...(tag ? { tag } : {}),
        defaults: literalDefaults(fn, source),
        ...update,
      })
      elements.set(name, { element, rank })
    }
  }

  const isCvaCall = (node: Node | undefined): node is NamedCall =>
    isCallTo(node) && cvas.has(node.callee.name)

  const trackCva = (node: Node, ancestors: Node[]) => {
    if (isCvaCall(node)) {
      track(ancestors, { variantSet: node.callee.name }, passesClassName(node))
    }
  }

  // Raw data-slot values each module class lands on, for group/peer markers.
  const slotDataSlots = new Map<string, Set<string>>()
  const addDataSlot = (slot: string, value: string) => {
    const values = slotDataSlots.get(slot) ?? new Set()
    slotDataSlots.set(slot, values.add(value))
  }

  // An element without a data-slot whose upstream classes contain `size-` is
  // what `svg:not([class*="size-"])` skips; the probe finds it by an attribute
  // here. Only a className written on the element itself (a string, or cn())
  // is marked: the attribute reaches the DOM through the component's props.
  const sized = new Set<string>()
  const markSized = (slot: string, classes: string[], ancestors: Node[]) => {
    if (!classes.join(' ').includes(SIZE_PROBE) || dataSlot(ancestors) !== undefined) return
    const opening = ancestors.findLast(
      (n): n is JSXOpeningElement => n.type === 'JSXOpeningElement',
    )
    sized.add(slot)
    out.appendLeft(opening?.name.end as number, ` ${SIZE_ATTRIBUTE}=""`)
  }

  // Adds a slot and returns the module class it got. Two elements asking for
  // the same name with different classes (FieldTitle reusing FieldLabel's
  // data-slot) keep them apart: the second takes its owner's name, or a number.
  const addSlot = (slot: Slot, ancestors: Node[] = []): string => {
    const owner = ownerName(ancestors)
    const names = [slot.name, ...(owner ? [camelCase(owner)] : [])]
    for (let i = 0; ; i++) {
      const name = names[i] ?? `${slot.name}${i - names.length + 2}`
      const existing = slots.find((s) => s.name === name)
      if (existing && existing.classes.join(' ') !== slot.classes.join(' ')) continue
      if (!existing) slots.push({ ...slot, name })
      const raw = dataSlot(ancestors)
      if (raw !== undefined) addDataSlot(name, raw)
      return name
    }
  }

  // Class strings reaching className some other way would ship as Tailwind
  // classes with no CSS: through a string constant, or through a call other
  // than cn() or a converted cva().
  const refuseRawClasses = (node: Node) => {
    if (node.type === 'Identifier' && constants.has(node.name)) {
      unsupported(node, `class string constant ${node.name}`)
    }
    if (
      node.type === 'CallExpression' &&
      !isCallTo(node, 'cn') &&
      !isCvaCall(node) &&
      node.arguments.some((arg) => arg.type === 'StringLiteral')
    ) {
      unsupported(node, 'class strings passed to a function other than cn() or a cva()')
    }
  }

  // Pass 1: imports and cva declarations.
  for (const statement of ast.program.body) {
    if (statement.type === 'ImportDeclaration') {
      lastImportEnd = statement.end as number
      const names = statement.specifiers.map((s) => s.local.name)
      if (statement.source.value === 'class-variance-authority') {
        // Take the preceding line break with it so no blank line is left
        // behind; the imports the mirror adds go right after this point.
        const start = statement.start as number
        out.remove(source[start - 1] === '\n' ? start - 1 : start, statement.end as number)
        continue
      }
      const [, kind, item] = REGISTRY_IMPORT.exec(statement.source.value) ?? []
      if (item) {
        registryImports.push(item)
        const module = registryModule(namespace, item, kind as 'ui' | 'hooks')
        out.overwrite(...span(statement.source), JSON.stringify(module))
        continue
      }
      if (names.includes('cn')) {
        if (names.length > 1) unsupported(statement, 'cn imported alongside other names')
        // Replaced at the end, once it is known whether any cva() needs ClassValue.
        cnImport = span(statement)
        continue
      }
    }
    if (statement.type === 'VariableDeclaration') {
      for (const d of statement.declarations) {
        if (
          d.id.type === 'Identifier' &&
          (d.init?.type === 'StringLiteral' || d.init?.type === 'TemplateLiteral')
        ) {
          constants.add(d.id.name)
        }
      }
      const [declarator] = statement.declarations
      const init = declarator?.init
      if (declarator?.id.type === 'Identifier' && isCallTo(init, 'cva')) {
        const cva = convertCva(statement, init, declarator.id.name, component)
        cvas.set(declarator.id.name, cva)
        converted.add(init)
        for (const slot of cva.slots) addSlot(slot)
        out.overwrite(...span(statement), cva.code)
        usesClsx = true
      }
    }
  }

  // Pass 2: VariantProps references, cn() calls, className literals.
  walk(ast.program, (node, ancestors) => {
    if (isCallTo(node, 'cva') && !converted.has(node)) {
      unsupported(node, 'cva() outside a top-level `const xVariants = cva(...)`')
    }

    // Every JSX element records its component, styled or not (a Base UI Root
    // renders only its data-slot).
    if (node.type === 'JSXOpeningElement') track([...ancestors, node], {}, false)

    if (
      node.type === 'TSTypeReference' &&
      node.typeName.type === 'Identifier' &&
      node.typeName.name === 'VariantProps'
    ) {
      const query = node.typeParameters?.params[0]
      if (query?.type !== 'TSTypeQuery' || query.exprName.type !== 'Identifier') {
        return unsupported(node, 'VariantProps of something other than a cva() variable')
      }
      const variable = query.exprName.name
      // Another mirrored module's cva() replacement: its props type is local
      // to that module, so derive it from the function's parameter.
      out.overwrite(
        ...span(node),
        cvas.get(variable)?.typeName ??
          `Omit<NonNullable<Parameters<typeof ${variable}>[0]>, "className">`,
      )
      return false
    }

    if (isCallTo(node, 'cn')) {
      const [only] = node.arguments
      if (node.arguments.length === 1 && isCvaCall(only)) {
        out.overwrite(...span(node), source.slice(...span(only)))
        trackCva(only, ancestors)
        return false
      }
      // A data-slot element styled only by the consumer's className is still
      // a component to test.
      const consumer = passesClassName(node)
      track(ancestors, {}, consumer)
      const base = () =>
        slotName(ancestors) ??
        unsupported(
          node,
          'cn() with class strings outside a nameable element (no data-slot, owner or tag)',
        )
      // Each string branch of a conditional argument gets its own class.
      const branches: { literal: StringLiteral; suffix: string }[] = []
      const checkArg = (arg: Node) => {
        if (
          !['StringLiteral', 'Identifier', 'MemberExpression', 'CallExpression'].includes(arg.type)
        ) {
          unsupported(arg, `cn() argument ${arg.type}`)
        }
        refuseRawClasses(arg)
        trackCva(arg, ancestors)
      }
      for (const arg of node.arguments) {
        if (arg.type === 'ConditionalExpression') {
          const name = conditionName(arg.test)
          for (const [branch, suffix] of [
            [arg.consequent, name],
            [arg.alternate, `Not${name}`],
          ] as const) {
            if (branch.type === 'StringLiteral') branches.push({ literal: branch, suffix })
            else checkArg(branch)
          }
          continue
        }
        // clsx's object form, `{ "h-2.5 w-2.5": indicator === "dot" }`: each
        // class string key becomes a `cond && styles.xDot` argument.
        if (arg.type === 'ObjectExpression') {
          const conditions: string[] = []
          for (const property of arg.properties) {
            if (
              property.type !== 'ObjectProperty' ||
              property.computed ||
              property.key.type !== 'StringLiteral'
            ) {
              unsupported(property, 'cn() object member other than "classes": condition')
            }
            const classes = classList(property.key)
            if (classes.length === 0) unsupported(property, 'cn() object key without classes')
            const name = base() + conditionName(property.value)
            const slot = addSlot({ name, classes }, ancestors)
            const test = source.slice(...span(property.value))
            const simple = ![
              'ConditionalExpression',
              'AssignmentExpression',
              'SequenceExpression',
            ].includes(property.value.type)
            conditions.push(
              `${simple && !/\|\||\?\?/.test(test) ? test : `(${test})`} && styles.${slot}`,
            )
          }
          // As clsx arguments: a computed key would need styles.x typed as a
          // string, which a consumer's CSS module types may not give.
          out.overwrite(...span(arg), conditions.join(', '))
          continue
        }
        if (arg.type === 'LogicalExpression' && arg.operator === '&&') {
          if (arg.right.type !== 'StringLiteral') unsupported(arg, 'cn() && without a string')
          branches.push({ literal: arg.right, suffix: conditionName(arg.left) })
          continue
        }
        if (staticClasses(arg) === undefined) checkArg(arg)
      }
      for (const { literal, suffix } of branches) {
        const classes = classList(literal)
        const slot =
          classes.length > 0 ? addSlot({ name: base() + suffix, classes }, ancestors) : ''
        out.overwrite(...span(literal), slot ? `styles.${slot}` : 'null')
      }
      const literals = node.arguments.filter((arg) => staticClasses(arg) !== undefined)
      const classes = literals.flatMap((arg) => staticClasses(arg) as string[])
      if (classes.length > 0) {
        const slot = addSlot({ name: base(), classes }, ancestors)
        const attribute = ancestors.at(-2)
        if (
          ancestors.at(-1)?.type === 'JSXExpressionContainer' &&
          attribute?.type === 'JSXAttribute' &&
          attribute.name.name === 'className'
        ) {
          markSized(slot, classes, ancestors.slice(0, -1))
        }
        if (keyedPart(ancestors) === undefined) track(ancestors, { slot }, consumer)
        out.overwrite(...span(literals[0] as Node), `styles.${slot}`)
      }
      // Literals merged into the first, or with no classes left at all.
      for (const literal of classes.length > 0 ? literals.slice(1) : literals) {
        removeArgument(out, node, literal)
      }
      out.overwrite(...span(node.callee), 'clsx')
      usesClsx = true
      return false
    }

    if (node.type === 'JSXAttribute' && node.name.name === 'className') {
      const value = node.value
      if (value?.type === 'StringLiteral') {
        const classes = classList(value)
        if (classes.length === 0) {
          out.remove(source.lastIndexOf(' ', node.start as number), node.end as number)
          return false
        }
        const name = slotName([...ancestors, node])
        if (!name) {
          unsupported(
            node,
            'className string outside a nameable element (no data-slot, owner or tag)',
          )
        }
        const slot = addSlot({ name, classes }, [...ancestors, node])
        markSized(slot, classes, [...ancestors, node])
        track([...ancestors, node], { slot }, false)
        out.overwrite(...span(value), `{styles.${slot}}`)
        return false
      }
      const expression = value?.type === 'JSXExpressionContainer' ? value.expression : undefined
      if (
        expression &&
        !['Identifier', 'MemberExpression', 'CallExpression'].includes(expression.type)
      ) {
        unsupported(expression, `className expression ${expression.type}`)
      }
      if (expression) {
        refuseRawClasses(expression)
        track([...ancestors, node], {}, passesClassName(expression))
        trackCva(expression, [...ancestors, node])
      }
    }
    return true
  })

  const clsx = clsxImport(cvas.size > 0)
  if (cnImport) out.overwrite(...cnImport, clsx)
  // A component with no classes (a re-export of Base UI) gets no module.
  const added = [
    ...(usesClsx && !cnImport ? [clsx] : []),
    ...(slots.length > 0 ? [`import styles from "./${pascalCase(component)}.module.scss"`] : []),
  ].join('\n')
  // With no imports, go after any directive ("use client" must stay first).
  const anchor = lastImportEnd || (ast.program.directives.at(-1)?.end ?? 0)
  if (added !== '' && anchor === 0) out.prepend(`${added}\n`)
  else if (added !== '') out.appendLeft(anchor, `\n${added}`)

  // A cva()'s classes land on every element a component applies it to.
  for (const component of components.values()) {
    const cva = component.variantSet ? cvas.get(component.variantSet) : undefined
    if (component.dataSlot === undefined) continue
    for (const slot of cva?.slots ?? []) addDataSlot(slot.name, component.dataSlot)
  }
  const dataSlots = Object.fromEntries(
    [...slotDataSlots].map(([slot, values]) => [slot, [...values].sort()]),
  )
  const markers = slots.flatMap((slot) =>
    slot.classes
      .filter((c) => MARKER.test(c))
      .map((marker) => ({ marker, slot: slot.name, dataSlots: dataSlots[slot.name] ?? [] })),
  )

  // Hooks, and the components that call one that throws.
  const hooks: Hook[] = []
  for (const statement of ast.program.body) {
    const hook = topLevelFunction(statement)
    if (!hook || !/^use[A-Z]/.test(hook.name)) continue
    const { fn } = hook
    let message: string | undefined
    walk(fn, (node) => {
      if (
        message === undefined &&
        node.type === 'ThrowStatement' &&
        node.argument.type === 'NewExpression' &&
        node.argument.arguments[0]?.type === 'StringLiteral'
      ) {
        message = node.argument.arguments[0].value
      }
      return true
    })
    hooks.push({ name: hook.name, ...(message !== undefined ? { throws: message } : {}) })
  }
  for (const statement of ast.program.body) {
    const owner = topLevelFunction(statement)
    const record = owner ? components.get(owner.name) : undefined
    if (!owner || !record) continue
    walk(owner.fn, (node) => {
      if (
        node.type === 'LogicalExpression' &&
        (node.operator === '??' || node.operator === '||') &&
        node.left.type === 'Identifier' &&
        node.left.name === 'children'
      ) {
        record.defaultChildren = true
      }
      const hook = isCallTo(node) ? hooks.find((h) => h.name === node.callee.name) : undefined
      if (hook?.throws !== undefined && record.throwsOutside === undefined) {
        record.throwsOutside = hook.throws
      }
      return true
    })
  }

  return {
    code: out.toString(),
    slots,
    hooks,
    dataSlots,
    sized: [...sized],
    markers,
    variantSets: [...cvas.values()].map((cva) => cva.set),
    components: [...components.values()],
    registryImports,
  }
}
