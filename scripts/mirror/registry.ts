// Upserts generated items into registry.json, keeping hand-written items and
// the existing order; new items are appended.

import type { RegistryItem } from './component.ts'

export type Registry = {
  items: { name: string }[]
  [key: string]: unknown
}

export function upsertItems(registry: Registry, items: RegistryItem[]): Registry {
  const next = [...registry.items]
  for (const item of items) {
    const index = next.findIndex((existing) => existing.name === item.name)
    if (index === -1) next.push(item)
    else next[index] = item
  }
  return { ...registry, items: next }
}
