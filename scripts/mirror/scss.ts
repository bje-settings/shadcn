// Turns Tailwind's flattened output for one slot's classes into a nested SCSS
// block under a single module class.
//
// Every utility rule is `[@media|@supports wrappers] <selector containing the
// utility class> { declarations }`. The utility class becomes `&`, the rule
// nests under the slot's class, and adjacent rules that share a selector and
// wrappers merge. Order is preserved exactly: Tailwind emits utilities in
// cascade order, and only adjacent blocks merge, so no declaration moves past
// another that could override it.
//
// The slot class is wrapped in :where() so a consumer's className always
// outranks the component's defaults, the job tailwind-merge does upstream.

import postcss, { type AtRule, type Rule } from 'postcss'
import selectorParser from 'postcss-selector-parser'

export type Slot = {
  // camelCase module class name
  name: string
  classes: string[]
}

export type ScssBlock = {
  scss: string
  // group/peer marker classes, which have no CSS of their own. Any other class
  // Tailwind produces no CSS for fails the conversion.
  unresolved: string[]
  // Custom properties the block reads but does not set: the global variables
  // file has to provide them.
  customProperties: string[]
  // Why rules were dropped here: a consumer class or an absent marker.
  dropped: string[]
}

export type SlotOptions = {
  // Selectors for the mirrored elements whose upstream classes contain a
  // fragment: what upstream's `[class*="size-"]` probes find here.
  classProbe: (fragment: string) => string[]
  // Reason each configured consumer class's rules are dropped, by class
  consumerClasses: Map<string, string>
  // Selector each group/peer marker class becomes: the data-slot of the
  // elements carrying it (`[data-slot="card"]` for `group/card`), or their
  // module class when they render none.
  markers: Map<string, string>
}

type Item = { decl: string } | Block
type Block = { key: string; items: Item[] }

function isBlock(item: Item | undefined): item is Block {
  return item !== undefined && 'items' in item
}

function wrappersOf(rule: Rule, layer: AtRule): string[] {
  const wrappers: string[] = []
  // optimize() leaves only at-rules between a utility rule and the layer.
  for (let node = rule.parent as AtRule; node !== layer; node = node.parent as AtRule) {
    if (node.type !== 'atrule') throw new Error(`unexpected nested rule in ${rule.selector}`)
    wrappers.unshift(`@${node.name} ${node.params}`)
  }
  return wrappers
}

// Classes Tailwind variants may name outside the element: `.dark` from the
// dark variant, marked :global() so CSS modules leave it alone, and group or
// peer markers, which become the selector options.markers gives them. Any
// other class would never be on an element here.
const GLOBAL_CLASSES = new Set(['dark'])

// Tailwind's group and peer marker classes: they have no CSS of their own.
export const MARKER = /^(group|peer)(\/[\w-]+)?$/

// A `:not()` whose every argument probes class names, like upstream's
// `svg:not([class*="size-"])`: a default for icons that set no size of their
// own. It becomes `:not()` of the mirrored elements whose upstream classes
// match, or goes when none do.
function resolveClassProbes(root: selectorParser.Root, classProbe: SlotOptions['classProbe']) {
  root.walkPseudos((pseudo) => {
    if (pseudo.value !== ':not') return
    const probes = pseudo.nodes.map((inner) => {
      const [only, ...rest] = inner.nodes
      return only?.type === 'attribute' && only.attribute === 'class' && only.operator === '*='
        ? rest.length === 0 && only.value
        : undefined
    })
    if (!probes.every((probe) => typeof probe === 'string')) return
    const selectors = [...new Set(probes.flatMap((probe) => classProbe(probe)))].sort()
    if (selectors.length === 0) pseudo.remove()
    else {
      pseudo.removeAll()
      for (const node of selectorParser().astSync(selectors.join(', ')).nodes) pseudo.append(node)
    }
  })
}

// The utility's own class becomes `&`; an allowed outside class is marked
// :global() or CSS modules would rename it and the selector would never match.
function nestSelector(
  selector: string,
  candidates: Set<string>,
  resolved: Set<string>,
  options: SlotOptions,
): string {
  return selectorParser((root) => {
    resolveClassProbes(root, options.classProbe)
    root.walkClasses((node) => {
      if (candidates.has(node.value)) {
        resolved.add(node.value)
        node.replaceWith(selectorParser.nesting({ value: '&' }))
        return
      }
      const marker = options.markers.get(node.value)
      if (marker !== undefined) {
        const replacement = selectorParser().astSync(marker).first.first
        node.replaceWith(replacement)
        return
      }
      if (!GLOBAL_CLASSES.has(node.value)) {
        throw new Error(
          `selector ${selector} references class .${node.value} outside the module; list it in consumerClasses if only a consumer adds it`,
        )
      }
      node.replaceWith(
        selectorParser.pseudo({
          value: ':global',
          nodes: [selectorParser.selector({ nodes: [node.clone()], value: '' })],
        }),
      )
    })
  }).processSync(selector)
}

function insert(root: Block, path: string[], decls: string[]): void {
  let block = root
  for (const key of path) {
    const last = block.items.at(-1)
    if (isBlock(last) && last.key === key) {
      block = last
    } else {
      const child: Block = { key, items: [] }
      block.items.push(child)
      block = child
    }
  }
  block.items.push(...decls.map((decl) => ({ decl })))
}

function print(block: Block, depth: number): string[] {
  const indent = '  '.repeat(depth)
  const lines = [`${indent}${block.key} {`]
  for (const item of block.items) {
    if (isBlock(item)) lines.push(...print(item, depth + 1))
    else lines.push(`${indent}  ${item.decl};`)
  }
  lines.push(`${indent}}`)
  return lines
}

function classesIn(selector: string): string[] {
  const found: string[] = []
  selectorParser((root) => {
    root.walkClasses((node) => {
      found.push(node.value)
    })
  }).processSync(selector)
  return found
}

// Why a rule is dropped, if it is: besides the slot's own utilities, it needs
// a configured consumer class, or a group/peer marker no mirrored element
// carries, so it never applies.
function dropReason(
  selector: string,
  candidates: Set<string>,
  options: SlotOptions,
): string | undefined {
  const classes = classesIn(selector).filter((c) => !candidates.has(c))
  const consumer = classes.find((c) => options.consumerClasses.has(c))
  if (consumer) return options.consumerClasses.get(consumer)
  const missing = classes.find((c) => MARKER.test(c) && !options.markers.has(c))
  return missing && `needs a ${missing} marker, which no mirrored component carries.`
}

export function slotToScss(css: string, slot: Slot, options: SlotOptions): ScssBlock {
  const candidates = new Set(slot.classes)
  const resolved = new Set<string>()
  const dropped = new Set<string>()
  const root: Block = { key: `:where(.${slot.name})`, items: [] }
  const reads = new Set<string>()
  const sets = new Set<string>()

  const layer = postcss
    .parse(css)
    .nodes.find(
      (node): node is AtRule =>
        node.type === 'atrule' && node.name === 'layer' && node.params === 'utilities',
    )

  layer?.walkRules((rule) => {
    const kept = rule.selectors.filter((selector) => {
      const reason = dropReason(selector, candidates, options)
      if (reason === undefined) return true
      dropped.add(reason)
      for (const c of classesIn(selector)) if (candidates.has(c)) resolved.add(c)
      return false
    })
    if (kept.length === 0) return
    const selectors = [
      ...new Set(kept.map((selector) => nestSelector(selector, candidates, resolved, options))),
    ]
    const decls: string[] = []
    rule.walkDecls((decl) => {
      if (decl.prop.startsWith('--')) sets.add(decl.prop)
      for (const [, name] of decl.value.matchAll(/var\((--[\w-]+)/g)) reads.add(name as string)
      decls.push(`${decl.prop}: ${decl.value}${decl.important ? ' !important' : ''}`)
    })
    const selector = selectors.join(', ')
    // Any other selector inspecting class names looks for Tailwind classes no
    // element carries here.
    if (/\[class[~|^$*]?=/.test(selector)) {
      throw new Error(`${slot.name}: selector ${selector} matches class names outside :not()`)
    }
    const wrappers = wrappersOf(rule, layer)
    insert(root, selector === '&' ? wrappers : [selector, ...wrappers], decls)
  })

  const unresolved = slot.classes.filter((c) => !resolved.has(c))
  const unknown = unresolved.filter((c) => !MARKER.test(c))
  if (unknown.length > 0) {
    throw new Error(`${slot.name}: Tailwind produced no CSS for ${unknown.join(' ')}`)
  }
  return {
    scss: print(root, 0).join('\n'),
    unresolved,
    customProperties: [...reads].filter((name) => !sets.has(name)).sort(),
    dropped: [...dropped],
  }
}
