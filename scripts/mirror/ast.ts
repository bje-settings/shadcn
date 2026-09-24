// Babel helpers shared by the modules that read upstream TSX.

import { parse } from '@babel/parser'
import type { File, Node } from '@babel/types'

export function parseModule(source: string): File {
  return parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
}

// Babel sets start and end on every node it parses.
export function span(node: Node): [number, number] {
  return [node.start as number, node.end as number]
}

// A node's child nodes. Position data, parser extras and attached comments
// are not children.
export function childNodes(node: Node): Node[] {
  return Object.entries(node).flatMap(([key, value]) => {
    if (key === 'loc' || key === 'extra' || key.endsWith('Comments')) return []
    return (Array.isArray(value) ? value : [value]).filter(
      (child): child is Node =>
        typeof child === 'object' && child !== null && typeof child.type === 'string',
    )
  })
}
