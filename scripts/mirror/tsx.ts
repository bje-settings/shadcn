// Rewrites an upstream component so its Tailwind classes move into a CSS
// module. Edits are applied in place with magic-string, leaving everything
// the mirror does not need to touch byte-for-byte as upstream wrote it.
//
// Supported class sources (anything else fails loudly with its position):
// - `const xVariants = cva(base, { variants, defaultVariants })`: replaced by
//   a lookup object and a same-named function with cva's call signature, so
//   `xVariants({ variant, size, className })` and `VariantProps<typeof
//   xVariants>` call sites keep working.
// - `className="..."` on an element with `data-slot`.
// - `cn("...", ...)` inside such an element's className, and `cn(xVariants(...))`.

import { parse } from '@babel/parser'
import type {
  CallExpression,
  FunctionDeclaration,
  Node,
  ObjectExpression,
  SourceLocation,
  StringLiteral,
  VariableDeclaration,
} from '@babel/types'
import MagicString from 'magic-string'
import { camelCase, pascalCase } from './names.ts'
import type { Slot } from './scss.ts'

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
    options: { value: string; slot: string }[]
  }[]
}

// A top-level component function and the element whose classes it sets.
export type RenderedComponent = {
  name: string
  // Raw data-slot of that element (a JSX attribute or useRender's state.slot)
  dataSlot: string
  // Module class for the component's own class strings
  slot?: string
  // cva() variable whose classes it applies
  variantSet?: string
  // Destructured props with a literal default, as source text
  defaults: { prop: string; value: string }[]
}

export type TransformedComponent = {
  code: string
  slots: Slot[]
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

function span(node: Node): [number, number] {
  return [node.start as number, node.end as number]
}

// visit returns false to skip the node's children.
function walk(
  node: Node,
  visit: (node: Node, ancestors: Node[]) => boolean,
  ancestors: Node[] = [],
): void {
  if (!visit(node, ancestors)) return
  const next = [...ancestors, node]
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'extra' || key.endsWith('Comments')) continue
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child === 'object' && typeof child.type === 'string') {
        walk(child as Node, visit, next)
      }
    }
  }
}

function classList(literal: StringLiteral): string[] {
  return literal.value.split(/\s+/).filter(Boolean)
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
  if (node.type !== 'StringLiteral')
    unsupported(node, `expected a string literal, got ${node.type}`)
  return node
}

function key(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name)
}

type Cva = {
  typeName: string
  slots: Slot[]
  code: string
  set: VariantSet
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
  const slots: Slot[] = [{ name: prefix, classes: classList(stringValue(baseArg)) }]

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
    const choices = objectEntries(options).map(([option, value]) => {
      const name = `${short ? group : `${prefix}${pascalCase(group)}`}${pascalCase(option)}`
      slots.push({ name, classes: classList(stringValue(value)) })
      return { value: option, slot: name }
    })
    const lines = choices.map(({ value, slot }) => `    ${key(value)}: styles.${slot},`)
    return { group, choices, lines: [`  ${key(group)}: {`, ...lines, '  },'] }
  })

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
  const render = ancestors.findLast(
    (node) =>
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === 'useRender',
  )
  // A class string inside useRender() is inside its options argument.
  if (render?.type !== 'CallExpression') return undefined
  const options = render.arguments[0] as Node
  const state = objectEntries(options).find(([name]) => name === 'state')?.[1]
  const slot = state ? objectEntries(state).find(([name]) => name === 'slot')?.[1] : undefined
  return slot ? stringValue(slot).value : undefined
}

function literalDefaults(fn: FunctionDeclaration, source: string): RenderedComponent['defaults'] {
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

function slotName(ancestors: Node[]): string | undefined {
  const slot = dataSlot(ancestors)
  return slot === undefined ? undefined : camelCase(slot)
}

const REGISTRY_IMPORT = /^@\/registry\/[^/]+\/ui\/([a-z0-9-]+)$/

export function transformComponent(
  source: string,
  component: string,
  namespace: string,
): TransformedComponent {
  const ast = parse(source, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  })
  const out = new MagicString(source)
  const cvas = new Map<string, Cva>()
  const slots: Slot[] = []
  const components = new Map<string, RenderedComponent>()
  const registryImports: string[] = []
  let usesClsx = false
  let cnImport: [number, number] | undefined
  let lastImportEnd = 0

  // Records, per top-level component function, the element its classes land
  // on. Only the first data-slot a function styles counts as its own.
  const track = (ancestors: Node[], update: Pick<RenderedComponent, 'slot' | 'variantSet'>) => {
    const fn = ancestors.find((node) => node.type === 'FunctionDeclaration')
    const slot = dataSlot(ancestors)
    if (fn?.type !== 'FunctionDeclaration' || !fn.id || slot === undefined) return
    const name = fn.id.name
    const record = components.get(name) ?? {
      name,
      dataSlot: slot,
      defaults: literalDefaults(fn, source),
    }
    components.set(name, record)
    if (record.dataSlot === slot) Object.assign(record, update)
  }

  const trackCva = (call: Node, ancestors: Node[]) => {
    if (
      call.type === 'CallExpression' &&
      call.callee.type === 'Identifier' &&
      cvas.has(call.callee.name)
    ) {
      track(ancestors, { variantSet: call.callee.name })
    }
  }

  const addSlot = (node: Node, slot: Slot) => {
    const existing = slots.find((s) => s.name === slot.name)
    if (!existing) slots.push(slot)
    else if (existing.classes.join(' ') !== slot.classes.join(' ')) {
      unsupported(node, `slot ${slot.name} has different classes in two places`)
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
      const item = REGISTRY_IMPORT.exec(statement.source.value)?.[1]
      if (item) {
        registryImports.push(item)
        const file = pascalCase(item)
        out.overwrite(
          ...span(statement.source),
          JSON.stringify(`@/registry/${namespace}/ui/${file}/${file}`),
        )
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
      const [declarator] = statement.declarations
      const init = declarator?.init
      if (
        declarator?.id.type === 'Identifier' &&
        init?.type === 'CallExpression' &&
        init.callee.type === 'Identifier' &&
        init.callee.name === 'cva'
      ) {
        const cva = convertCva(statement, init, declarator.id.name, component)
        cvas.set(declarator.id.name, cva)
        for (const slot of cva.slots) addSlot(init, slot)
        out.overwrite(...span(statement), cva.code)
        usesClsx = true
      }
    }
  }

  // Pass 2: VariantProps references, cn() calls, className literals.
  walk(ast.program, (node, ancestors) => {
    if (
      node.type === 'TSTypeReference' &&
      node.typeName.type === 'Identifier' &&
      node.typeName.name === 'VariantProps'
    ) {
      const query = node.typeParameters?.params[0]
      const target =
        query?.type === 'TSTypeQuery' && query.exprName.type === 'Identifier'
          ? cvas.get(query.exprName.name)
          : undefined
      if (!target) unsupported(node, 'VariantProps of something other than a cva() variable')
      out.overwrite(...span(node), target.typeName)
      return false
    }

    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === 'cn'
    ) {
      const [only] = node.arguments
      if (
        node.arguments.length === 1 &&
        only?.type === 'CallExpression' &&
        only.callee.type === 'Identifier' &&
        cvas.has(only.callee.name)
      ) {
        out.overwrite(...span(node), source.slice(...span(only)))
        trackCva(only, ancestors)
        return false
      }
      for (const arg of node.arguments) {
        if (
          !['StringLiteral', 'Identifier', 'MemberExpression', 'CallExpression'].includes(arg.type)
        ) {
          unsupported(arg, `cn() argument ${arg.type}`)
        }
        trackCva(arg, ancestors)
      }
      const literals = node.arguments.filter((arg) => arg.type === 'StringLiteral')
      const [first, ...others] = literals
      if (first) {
        const slot = slotName(ancestors)
        if (!slot) unsupported(node, 'cn() with class strings outside an element with data-slot')
        addSlot(node, { name: slot, classes: literals.flatMap(classList) })
        track(ancestors, { slot })
        out.overwrite(...span(first), `styles.${slot}`)
        for (const literal of others) {
          const previous = node.arguments[node.arguments.indexOf(literal) - 1] as Node
          out.remove(previous.end as number, literal.end as number)
        }
      }
      out.overwrite(...span(node.callee), 'clsx')
      usesClsx = true
      return false
    }

    if (node.type === 'JSXAttribute' && node.name.name === 'className') {
      const value = node.value
      if (value?.type === 'StringLiteral') {
        const slot = slotName(ancestors)
        if (!slot) unsupported(node, 'className string on an element without data-slot')
        addSlot(node, { name: slot, classes: classList(value) })
        track([...ancestors, node], { slot })
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
      if (expression) trackCva(expression, [...ancestors, node])
    }
    return true
  })

  const clsx = clsxImport(cvas.size > 0)
  if (cnImport) out.overwrite(...cnImport, clsx)
  const added = [
    ...(usesClsx && !cnImport ? [clsx] : []),
    `import styles from "./${pascalCase(component)}.module.scss"`,
  ].join('\n')
  if (lastImportEnd === 0) out.prepend(`${added}\n`)
  else out.appendLeft(lastImportEnd, `\n${added}`)

  return {
    code: out.toString(),
    slots,
    variantSets: [...cvas.values()].map((cva) => cva.set),
    components: [...components.values()],
    registryImports,
  }
}
