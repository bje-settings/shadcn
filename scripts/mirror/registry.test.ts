import { describe, expect, it } from 'vitest'
import type { RegistryItem } from './component.ts'
import { parseRegistry, upsertItems } from './registry.ts'

const item = (name: string, title: string, path = `registry/ui/${name}.tsx`): RegistryItem => ({
  name,
  type: 'registry:ui',
  title,
  dependencies: [],
  devDependencies: [],
  registryDependencies: [],
  files: [{ path, type: 'registry:ui' }],
})

const owned = (entry: { files?: { path: string }[] }) =>
  (entry.files ?? []).some(({ path }) => path.startsWith('registry/ui/'))

describe('upsertItems', () => {
  it('replaces items in place, appends new ones and keeps hand-written ones', () => {
    const registry = { name: 'bje', items: [{ name: 'cn' }, item('button', 'Old')] }
    const next = upsertItems(registry, [item('button', 'New'), item('card', 'Card')], { owned })
    expect(next.name).toBe('bje')
    expect(next.items).toEqual([{ name: 'cn' }, item('button', 'New'), item('card', 'Card')])
    expect(registry.items[1]).toEqual(item('button', 'Old'))
  })

  it('drops generated items the mirror no longer produces', () => {
    const registry = {
      items: [item('removed', 'Removed'), item('lib', 'Lib', 'registry/lib/x.ts')],
    }
    expect(upsertItems(registry, [], { owned }).items).toEqual([
      item('lib', 'Lib', 'registry/lib/x.ts'),
    ])
  })
})

describe('parseRegistry', () => {
  it('accepts a registry with named items', () => {
    const raw = { name: 'bje', items: [{ name: 'cn' }] }
    expect(parseRegistry(raw, 'registry.json')).toEqual(raw)
  })

  it.each([
    ['a non-object', [], 'registry.json: registry must be an object'],
    ['items that are not an array', { items: {} }, 'registry.json: items must be an array'],
    [
      'an item without a name',
      { items: [{}] },
      'registry.json: items[0].name must be a non-empty string',
    ],
  ])('rejects %s', (_, raw, message) => {
    expect(() => parseRegistry(raw, 'registry.json')).toThrow(message)
  })
})
