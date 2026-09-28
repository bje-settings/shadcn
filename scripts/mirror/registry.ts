// Each style's registry catalog: the hand-written items of the base
// registry.json, then the style's generated items, under the style's own
// homepage. Generated in full, so an item the mirror stops producing (a
// component removed from mirror.config.json) goes with its files.

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

// `style` is the short name the site serves the style under: the registry's
// homepage is the site's, plus that path.
export function styleRegistry(base: Registry, items: RegistryItem[], style: string): Registry {
  if (typeof base.homepage !== 'string') throw new Error('registry.json: homepage must be a string')
  const homepage = `${base.homepage}/${style}`
  const handWritten = new Set(base.items.map((item) => item.name))
  const clash = items.find((item) => handWritten.has(item.name))
  if (clash) throw new Error(`registry.json: ${clash.name} is hand-written and generated`)
  return { ...base, homepage, items: [...base.items, ...items] }
}
