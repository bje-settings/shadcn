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

import postcss, { type ChildNode, type Container } from 'postcss'

import { renameInternal } from './internal.ts'

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
  for (const node of root.nodes) parts[destination(node)].push(renameInternal(node.toString()))
  const file = (blocks: string[], extra: string[] = []) =>
    [header, ...extra, '', blocks.join('\n\n'), ''].join('\n')
  return {
    variables: file(parts.variables),
    // Preflight is Tailwind's code: keep its license notice with it.
    base: file(parts.base, license ? [license.toString()] : []),
  }
}
