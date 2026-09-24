// Upserts generated items into registry.json. Hand-written items keep their
// place; generated ones are replaced in place or appended. Generated items the
// mirror no longer produces (a component removed from mirror.config.json) are
// dropped, since their files are gone.

import type { RegistryItem } from './component.ts'
import { Shape } from './parse.ts'

export type RegistryEntry = { name: string; files?: { path: string }[] }

export type Registry = {
  items: RegistryEntry[]
  [key: string]: unknown
}

export function parseRegistry(raw: unknown, where: string): Registry {
  const shape: Shape = new Shape(where)
  const registry = shape.record(raw, 'registry')
  const items = registry.items
  if (!Array.isArray(items)) shape.fail('items must be an array')
  items.forEach((item: unknown, i) => {
    shape.string(shape.record(item, `items[${i}]`).name, `items[${i}].name`)
  })
  return registry as Registry
}

export function upsertItems(
  registry: Registry,
  items: RegistryItem[],
  { owned }: { owned: (item: RegistryEntry) => boolean },
): Registry {
  const generated = new Set(items.map((item) => item.name))
  const next: RegistryEntry[] = registry.items.filter(
    (existing) => generated.has(existing.name) || !owned(existing),
  )
  for (const item of items) {
    const index = next.findIndex((existing) => existing.name === item.name)
    if (index === -1) next.push(item)
    else next[index] = item
  }
  return { ...registry, items: next }
}
