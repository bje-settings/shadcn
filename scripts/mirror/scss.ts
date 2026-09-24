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
  // No rule came out: Sass drops the empty block, so the module exports no
  // class for it (a slot holding only a group marker).
  empty: boolean
  // Why rules were dropped here: a consumer class or an absent marker.
  dropped: string[]
}

export type SlotOptions = {
  // Selectors for the mirrored elements whose upstream classes contain a
  // fragment: what upstream's `[class*="size-"]` probes find here.
  classProbe: (fragment: string) => string[]
  // Reason each configured consumer class's rules are dropped, by class
  consumerClasses: Map<string, string>
  // Classes a selector may name outside the module (`.dark` from the dark
  // variant), kept as :global() so CSS modules leave them alone. Group and
  // peer markers become the selector `markers` gives them; any other outside
  // class would never be on an element here.
  globalClasses: Set<string>
  // Upstream classes known to compile to nothing
  withoutCss: Set<string>
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

// Tailwind's group and peer marker classes: they have no CSS of their own.
export const MARKER = /^(group|peer)(\/[\w-]+)?$/

// A `:not()` whose every argument probes class names, like upstream's
// `svg:not([class*="size-"])`: a default for icons that set no size of their
// own. It becomes `:where(:not())` of the mirrored elements whose upstream
// classes match, or goes when none do. :where() keeps it from adding
// specificity, so a consumer's own size class on an icon still wins, as it
// does upstream where the probe excludes that icon.
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
    else
      pseudo.replaceWith(
        selectorParser().astSync(`:where(:not(${selectors.join(', ')}))`).first.first,
      )
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
      if (!options.globalClasses.has(node.value)) {
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

// Whether a nested selector styles another element than the slot's own: a
// combinator follows `&` (`& svg`, `& > *`, `:is(& > *)`).
function targetsDescendant(selector: string): boolean {
  let descendant = false
  selectorParser((root) => {
    root.walkNesting((nesting) => {
      const siblings = (nesting.parent as selectorParser.Selector).nodes
      if (siblings.slice(siblings.indexOf(nesting) + 1).some((n) => n.type === 'combinator')) {
        descendant = true
      }
    })
  }).processSync(selector)
  return descendant
}

export function slotToScss(css: string, slot: Slot, options: SlotOptions): ScssBlock {
  const candidates = new Set(slot.classes)
  const resolved = new Set<string>()
  const dropped = new Set<string>()
  // The slot's own rules sit at zero specificity, so a consumer's className
  // wins as tailwind-merge makes it win upstream. Rules styling descendants
  // (Field's `*:w-full`) keep the class's specificity, as upstream's do: a
  // child's own zero-specificity rules must not outrank them.
  const root: Block = { key: `:where(.${slot.name})`, items: [] }
  const context: Block = { key: `.${slot.name}`, items: [] }
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
    // A rule gated on a class probe is a default an element's own class
    // overrides (an icon's size), so it stays at zero specificity even when it
    // styles descendants.
    const nested = kept.map((raw) => {
      const selector = nestSelector(raw, candidates, resolved, options)
      return { selector, context: targetsDescendant(selector) && !/\[class\*=/.test(raw) }
    })
    const selectors = [...new Set(nested.map((n) => n.selector))]
    const decls: string[] = []
    rule.walkDecls((decl) => {
      if (decl.prop.startsWith('--')) sets.add(decl.prop)
      for (const [, name] of decl.value.matchAll(/var\((--[\w-]+)/g)) reads.add(name as string)
      decls.push(`${decl.prop}: ${decl.value}${decl.important ? ' !important' : ''}`)
    })
    // Any other selector inspecting class names looks for Tailwind classes no
    // element carries here.
    const probe = selectors.find((selector) => /\[class[~|^$*]?=/.test(selector))
    if (probe) throw new Error(`${slot.name}: selector ${probe} matches class names outside :not()`)
    const wrappers = wrappersOf(rule, layer)
    for (const [block, inContext] of [
      [root, false],
      [context, true],
    ] as const) {
      const group = new Set(nested.filter((n) => n.context === inContext).map((n) => n.selector))
      const selector = [...group].join(', ')
      if (selector === '') continue
      insert(block, selector === '&' ? wrappers : [selector, ...wrappers], decls)
    }
  })

  const unresolved = slot.classes.filter((c) => !resolved.has(c))
  const unknown = unresolved.filter((c) => !MARKER.test(c) && !options.withoutCss.has(c))
  if (unknown.length > 0) {
    throw new Error(`${slot.name}: Tailwind produced no CSS for ${unknown.join(' ')}`)
  }
  return {
    scss: [root, context]
      .filter((block) => block === root || block.items.length > 0)
      .flatMap((block) => print(block, 0))
      .join('\n'),
    unresolved,
    customProperties: [...reads].filter((name) => !sets.has(name)).sort(),
    empty: root.items.length === 0 && context.items.length === 0,
    dropped: [...dropped],
  }
}
