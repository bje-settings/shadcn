// Splits Tailwind's output for the project CSS, compiled over every mirrored
// component's classes, into the global stylesheets a consumer imports once:
//
// - variables.scss: @layer properties (fallbacks for Tailwind's --tw-*
//   variables), @layer theme (the tokens the components use), the @property
//   registrations, and the base color's :root and .dark variables.
// - base.scss: @layer base (Tailwind's preflight plus shadcn's base rules) and
//   any @keyframes the components animate with.
//
// Utilities are the components' own CSS and live in their modules. Anything
// else at the top level fails the build rather than being guessed at.

import postcss, { type ChildNode } from 'postcss'

export type GlobalStylesheets = { variables: string; base: string }

type Destination = keyof GlobalStylesheets | 'drop'

function destination(node: ChildNode): Destination {
  if (node.type === 'comment') return 'drop'
  if (node.type === 'rule' && (node.selector === ':root' || node.selector === '.dark')) {
    return 'variables'
  }
  if (node.type === 'atrule') {
    if (node.name === 'property') return 'variables'
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

export function globalStylesheets(css: string, header: string): GlobalStylesheets {
  const parts: Record<Destination, string[]> = { variables: [], base: [], drop: [] }
  const root = postcss.parse(css)
  const license = root.nodes.find((node) => node.type === 'comment')
  for (const node of root.nodes) parts[destination(node)].push(node.toString())
  const file = (blocks: string[], extra: string[] = []) =>
    [header, ...extra, '', blocks.join('\n\n'), ''].join('\n')
  return {
    variables: file(parts.variables),
    // Preflight is Tailwind's code: keep its license notice with it.
    base: file(parts.base, license ? [license.toString()] : []),
  }
}
