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
// Rules styling the slot's own element nest under :where(.slot), so a
// consumer's className outranks them, the job tailwind-merge does upstream.
// Rules styling descendants (`*:w-full`, `& svg`) nest under .slot and keep
// upstream's specificity.

import postcss, { type AtRule, type Root, type Rule } from 'postcss'
import selectorParser from 'postcss-selector-parser'

import { internalName, renameInternal } from './internal.ts'

// The class fragment upstream's `svg:not([class*="size-"])` defaults probe
// for, and the attribute the mirror puts on an element without a data-slot
// whose classes contain it.
export const SIZE_PROBE = 'size-'
export const SIZE_ATTRIBUTE = 'data-class-size'

export type Slot = {
  // camelCase module class name
  name: string
  classes: string[]
  // A variant option sets an arbitrary font size over the base's named one
  // (`text-sm`, then `text-[0.8rem]`): tailwind-merge drops the named size
  // and its line-height, so the element inherits its line-height here.
  resetsLeading?: boolean
}

export type ScssBlock = {
  scss: string
  // group/peer markers and configured classesWithoutCss, which have no CSS.
  // Any other class Tailwind produces no CSS for fails the conversion.
  unresolved: string[]
  // Custom properties the block reads but does not set: global tokens, or
  // ones an enclosing slot or an inline style sets.
  customProperties: string[]
  // No rule came out: Sass drops the empty block, so the module exports no
  // class for it (a slot holding only a group marker).
  empty: boolean
  // Why rules were dropped or loosened here: a consumer class, or a class
  // probe no mirrored element matches.
  dropped: string[]
  // Defaults for the internal variables (internal.ts) the block uses, and
  // the elements that use them, for the module's properties layer: the
  // slot's own element, and any pseudo-element or descendant a rule styles.
  defaults: Record<string, string>
  defaultSelectors: string[]
  // Renamed internal variables the block uses, and every other custom
  // property it reads or sets, to check that the two never share a name.
  internal: string[]
  external: string[]
}

// A named font size (`text-sm`, `text-xs/relaxed`): tailwind-merge drops a
// leading-* class from an element that gets one.
export const NAMED_TEXT_SIZE = /^text-(xs|sm|base|lg|xl|[2-9]xl)(\/[\w.[\]-]+)?$/

export type SlotOptions = {
  // Where a class probe default ranks among the others with the same variant
  // (`[&_svg:not([class*='size-'])]:` in front of size-3.5 or size-4), by
  // Tailwind's order for equal specificity: later wins. Zero for any other
  // class.
  probeRank: (candidate: string) => number
  // Selectors for the mirrored elements that set a named font size and no
  // leading of their own: the leading-* of a slot that also sets a named font
  // size (CardDescription's default typography) does not apply to them, as
  // tailwind-merge drops it when one component renders through another
  // (`render={<CardDescription />}`) and adds its own text size.
  textSized: string[]
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
  // Initial value of every internal variable, renamed (registrations())
  internalDefaults: Map<string, string>
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
// own. It keeps the probe (an icon's own class, a consumer's Tailwind class)
// and adds the mirrored elements whose upstream classes match, which here
// carry a data-slot or a size attribute instead; it goes when none do. The
// `:not()` counts toward specificity as it does upstream, so the default
// outranks a descendant rule of another component that styles the icon
// with fewer selectors.
function resolveClassProbes(
  root: selectorParser.Root,
  classProbe: SlotOptions['classProbe'],
  unmatched: Set<string>,
) {
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
    if (selectors.length === 0) {
      for (const probe of probes) unmatched.add(probe)
      pseudo.remove()
    } else
      pseudo.replaceWith(
        selectorParser().astSync(
          `:not(${[...new Set(probes)].map((probe) => `[class*="${probe}"]`).join(', ')}, ${selectors.join(', ')})`,
        ).first.first,
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
  unmatched: Set<string>,
): string {
  return selectorParser((root) => {
    resolveClassProbes(root, options.classProbe, unmatched)
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
// a configured consumer class, so it never applies. A group/peer marker no
// mirrored element carries fails the build: the item carrying it must be
// mirrored too, unless the rule's own class is listed in classesWithoutCss
// because upstream's markup never carries the marker either.
function dropReason(
  selector: string,
  candidates: Set<string>,
  options: SlotOptions,
): string | undefined {
  const classes = classesIn(selector).filter((c) => !candidates.has(c))
  const consumer = classes.find((c) => options.consumerClasses.has(c))
  if (consumer) return options.consumerClasses.get(consumer)
  const missing = classes.find((c) => MARKER.test(c) && !options.markers.has(c))
  const dead = [...candidates].find(
    (c) => options.withoutCss.has(c) && classesIn(selector).includes(c),
  )
  if (missing && dead) {
    return `${dead} matches nothing upstream either: no element carries ${missing}.`
  }
  if (missing) {
    throw new Error(
      `selector ${selector} needs a ${missing} marker, which no mirrored element with a data-slot carries`,
    )
  }
  return undefined
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

const INTERNAL_NAME = /--tw-[\w-]+/g

// Each internal variable's default, renamed, from Tailwind's own fallback for
// browsers without @property: the @layer properties rule setting them on every
// element. Its values suit an unregistered variable (`0px` where the
// registration's initial-value is a bare `0`, which calc() would reject). A
// utility can read a variable only another registers (text-sm reads the
// leading-* one), so the caller compiles every mirrored class once for the
// whole table.
export function registrations(css: string): Map<string, string> {
  const defaults = new Map<string, string>()
  postcss.parse(css).walkAtRules('layer', (layer) => {
    if (layer.params !== 'properties') return
    layer.walkDecls(/^--tw-/, (decl) => {
      defaults.set(internalName(decl.prop), decl.value)
    })
  })
  return defaults
}

// The internal variables each @keyframes reads (tw-animate-css's enter and
// exit), by keyframes name.
function keyframeReads(root: Root): Map<string, string[]> {
  const reads = new Map<string, string[]>()
  root.each((node) => {
    if (node.type !== 'atrule' || node.name !== 'keyframes') return
    reads.set(
      node.params,
      [...node.toString().matchAll(INTERNAL_NAME)].map(([name]) => internalName(name)),
    )
  })
  return reads
}

// Tailwind's optimizer writes these with one colon.
const LEGACY_PSEUDO_ELEMENTS = new Set([':before', ':after', ':first-line', ':first-letter'])

// The element a nested selector styles, for the defaults: a state of the slot
// (`&:hover`, `&[aria-invalid]`, `&:is(.dark *)`) is the slot's own element;
// a pseudo-element or a descendant keeps its selector.
function defaultTarget(selector: string, slot: string): string {
  const root = selectorParser().astSync(selector)
  let pseudoElement = false
  root.walkPseudos((pseudo) => {
    if (pseudo.value.startsWith('::') || LEGACY_PSEUDO_ELEMENTS.has(pseudo.value)) {
      pseudoElement = true
    }
  })
  if (!pseudoElement && !targetsDescendant(selector)) return `:where(.${slot})`
  root.walkNesting((nesting) => {
    nesting.replaceWith(selectorParser().astSync(`:where(.${slot})`).first.first)
  })
  return root.toString()
}

export function slotToScss(css: string, slot: Slot, options: SlotOptions): ScssBlock {
  const candidates = new Set(slot.classes)
  const resolved = new Set<string>()
  const dropped = new Set<string>()
  const unmatched = new Set<string>()
  // The slot's own rules sit at zero specificity, so a consumer's className
  // wins as tailwind-merge makes it win upstream. Rules styling descendants
  // (Field's `*:w-full`) keep the class's specificity, as upstream's do: a
  // child's own zero-specificity rules must not outrank them.
  const root: Block = { key: `:where(.${slot.name})`, items: [] }
  const context: Block = { key: `.${slot.name}`, items: [] }
  const reads = new Set<string>()
  const sets = new Set<string>()
  // Elements that use an internal variable, and the variables
  const users = new Set<string>()
  const internalNames = new Set<string>()

  const parsed = postcss.parse(css)
  const keyframes = keyframeReads(parsed)
  const layer = parsed.nodes.find(
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
      let selector = nestSelector(raw, candidates, resolved, options, unmatched)
      if (
        selector === '&' &&
        options.textSized.length > 0 &&
        slot.classes.some((c) => NAMED_TEXT_SIZE.test(c)) &&
        classesIn(raw).some((c) => candidates.has(c) && c.startsWith('leading-'))
      ) {
        selector = `&:where(:not(${options.textSized.join(', ')}))`
      }
      const rank = options.probeRank(
        classesIn(raw).find((c) => candidates.has(c) && /\[class\*=/.test(c)) ?? '',
      )
      const probe = /\[class\*="[^"]*"\]/.exec(selector)?.[0]
      if (rank > 0 && probe) selector += `:not(${probe})`.repeat(rank)
      return { selector, context: targetsDescendant(selector) }
    })
    const selectors = [...new Set(nested.map((n) => n.selector))]
    const decls: string[] = []
    let internal = false
    rule.walkDecls((decl) => {
      const prop = renameInternal(decl.prop)
      const value = renameInternal(decl.value)
      // Set or read with var(): transition-colors also names the gradient
      // variables in transition-property, which needs no default.
      const used = [
        ...decl.prop.matchAll(INTERNAL_NAME),
        ...decl.value.matchAll(/var\((--tw-[\w-]+)/g),
      ].map((match) => match[1] ?? match[0])
      for (const name of used) {
        internalNames.add(internalName(name))
        internal = true
      }
      if (decl.prop === 'animation' || decl.prop === 'animation-name') {
        for (const word of decl.value.split(/[\s,]+/)) {
          for (const name of keyframes.get(word) ?? []) {
            internalNames.add(name)
            internal = true
          }
        }
      }
      if (prop.startsWith('--')) sets.add(prop)
      for (const [, name] of value.matchAll(/var\((--[\w-]+)/g)) reads.add(name as string)
      decls.push(`${prop}: ${value}${decl.important ? ' !important' : ''}`)
    })
    if (internal) for (const n of nested) users.add(defaultTarget(n.selector, slot.name))
    // Any other selector inspecting class names looks for Tailwind classes no
    // element carries here.
    const probe = selectors.find((selector) =>
      /\[class[~|^$*]?=/.test(
        selector
          .replace(/:not\((?:\[class\*="[^"]*"\], )+/g, ':not(')
          .replace(/:not\(\[class\*="[^"]*"\]\)/g, ''),
      ),
    )
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

  if (slot.resetsLeading) insert(root, [], ['line-height: inherit'])
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
    customProperties: [...reads]
      .filter((name) => !sets.has(name) && !internalNames.has(name))
      .sort(),
    empty: root.items.length === 0 && context.items.length === 0,
    dropped: [
      ...dropped,
      ...[...unmatched].map(
        (probe) =>
          `upstream skips elements whose classes contain "${probe}", and no mirrored element does: the default applies to every match.`,
      ),
    ],
    defaults: Object.fromEntries(
      [...internalNames].sort().map((name) => {
        const value = options.internalDefaults.get(name)
        if (value === undefined) throw new Error(`${slot.name}: no registration for ${name}`)
        return [name, value]
      }),
    ),
    defaultSelectors: [...users].sort(),
    internal: [...internalNames].sort(),
    external: [...new Set([...reads, ...sets])].filter((name) => !internalNames.has(name)).sort(),
  }
}
