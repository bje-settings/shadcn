// Splits Tailwind's output for the project CSS, compiled over every mirrored
// component's classes, into the global stylesheets a consumer imports once:
//
// - variables.scss: @layer theme (Tailwind's whole default theme, which the
//   caller compiles static), the base color's :root and .dark variables, and
//   the @property registrations and @layer properties fallbacks of shadcn's
//   own utilities (scroll-fade, shimmer).
// - base.scss: @layer base (Tailwind's preflight plus shadcn's base rules) and
//   any @keyframes the components animate with.
//
// Tailwind's internal --tw-* variables are not globals: each module declares
// the ones it uses (internal.ts), so their registrations and fallbacks go, and
// the keyframes read them by their renamed names.
//
// Utilities are the components' own CSS and live in their modules. Anything
// else at the top level fails the build rather than being guessed at.

import postcss, { type AtRule, type ChildNode, type Container, type Rule } from 'postcss'

import { renameInternal } from './internal.ts'
import type { FontItem } from './project-css.ts'
import { needsUnknownUnitIgnore, UNKNOWN_UNIT_IGNORE, winners } from './stylesheet-lint.ts'

export type GlobalStylesheets = { variables: string; base: string }

type Destination = keyof GlobalStylesheets | 'drop'

function destination(node: ChildNode): Destination {
  if (node.type === 'comment') return 'drop'
  if (node.type === 'rule' && (node.selector === ':root' || node.selector === '.dark')) {
    return 'variables'
  }
  if (node.type === 'atrule') {
    if (node.name === 'property') return node.params.startsWith('--tw-') ? 'drop' : 'variables'
    if (node.name === 'keyframes') return 'base'
    if (node.name === 'layer') {
      if (node.params === 'properties' || node.params === 'theme') return 'variables'
      if (node.params === 'base') return 'base'
      if (node.params === 'components' || node.params === 'utilities') return 'drop'
    }
    // shadcn/tailwind.css's own unlayered utilities, e.g. .shimmer's
    // reduced-motion override: component CSS, not globals.
    if (
      node.name === 'media' &&
      node.nodes?.every((n) => n.type === 'rule' && n.selector.startsWith('.'))
    ) {
      return 'drop'
    }
  }
  throw new Error(`globals: no destination for top-level ${node.toString().split('\n')[0]}`)
}

// Fallback blocks left with no declaration, innermost first.
function removeEmpty(container: Container): void {
  for (const node of [...(container.nodes ?? [])]) {
    if (node.type !== 'rule' && node.type !== 'atrule') continue
    removeEmpty(node)
    if (node.nodes?.length === 0) node.remove()
  }
}

const IMPORTANT_IGNORE =
  "// biome-ignore lint/complexity/noImportantStyles: Tailwind's preflight keeps a hidden element hidden whatever display another rule gives it"

// Preflight's [hidden]:where(...) rule, one compound selector on the hidden
// element itself: no list, no combinator.
const HIDDEN = /^\[hidden\][^\s>+~]*$/

// Each block keeps one declaration per property (stylesheet-lint.ts), and an
// !important one, preflight's [hidden] display rule, gets a suppression on the
// line before it. The reason is that rule's, so an !important declaration
// anywhere else fails the build by name, to be given a reason of its own.
function forBiome(top: Container): void {
  const containers: Container[] = [top]
  top.walk((node) => {
    if (node.type === 'rule' || node.type === 'atrule') containers.push(node)
  })
  for (const container of containers) {
    const nodes = container.nodes ?? []
    const kept = new Set(
      winners(nodes, (node) =>
        node.type === 'decl' ? { prop: node.prop, important: node.important } : undefined,
      ),
    )
    for (const node of nodes.filter((n) => !kept.has(n))) node.remove()
  }
  top.walkDecls((decl) => {
    if (!decl.important) return
    const parent = decl.parent as Rule | AtRule
    const selector = parent.type === 'rule' ? parent.selector : `@${parent.name}`
    const hidden = parent.type === 'rule' && parent.selectors.every((s) => HIDDEN.test(s))
    if (!hidden || decl.prop !== 'display') {
      throw new Error(
        `globals: ${decl.prop} in ${selector} is !important outside preflight's [hidden] display rule`,
      )
    }
    // postcss sets raws.before on every node it parses.
    const raw = decl.raws.before as string
    // A line comment needs the declaration on the next line.
    const before = raw.includes('\n') ? raw : `\n${raw}`
    decl.raws.before = `${before}${IMPORTANT_IGNORE}${before}`
  })
}

export function globalStylesheets(css: string, header: string): GlobalStylesheets {
  const parts: Record<Destination, string[]> = { variables: [], base: [], drop: [] }
  const root = postcss.parse(css)
  const license = root.nodes.find((node) => node.type === 'comment')
  root.walkAtRules('layer', (layer) => {
    if (layer.params === 'properties')
      layer.walkDecls(/^--tw-/, (decl) => {
        decl.remove()
      })
  })
  removeEmpty(root)
  for (const node of root.nodes) {
    const to = destination(node)
    // Only what ships: a dropped utility's !important is not preflight's.
    if (to !== 'drop') forBiome(node as Container)
    parts[to].push(renameInternal(node.toString()))
  }
  const file = (blocks: string[], extra: string[] = []) => {
    const rules = blocks.join('\n\n')
    // Biome honours it only before any rule.
    const ignore = needsUnknownUnitIgnore(rules) ? [UNKNOWN_UNIT_IGNORE] : []
    return [header, ...ignore, ...extra, '', rules, ''].join('\n')
  }
  return {
    variables: file(parts.variables),
    // Preflight is Tailwind's code: keep its license notice with it.
    base: file(parts.base, license ? [license.toString()] : []),
  }
}

// A font item's stylesheet: the font's package, and the theme variable
// upstream's font item names (--font-sans, --font-heading, ...) set to its
// family. Same layer and selector as variables.scss, so loaded after it, it wins.
export function fontStylesheet(font: FontItem, header: string): string {
  const { dependency, variable, family } = font.font
  return [
    header,
    `/* Import after variables.scss: this replaces its ${variable}. */`,
    '',
    `@import ${JSON.stringify(dependency)};`,
    '',
    '@layer theme {',
    '  :root, :host {',
    `    ${variable}: ${family};`,
    '  }',
    '}',
    '',
  ].join('\n')
}
