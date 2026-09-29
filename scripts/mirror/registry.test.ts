import { describe, expect, it } from 'vitest'
import type { RegistryItem } from './component.ts'
import { parseRegistry, styleRegistry } from './registry.ts'

const item = (name: string, title: string, path = `registry/ui/${name}.tsx`): RegistryItem => ({
  name,
  type: 'registry:ui',
  title,
  dependencies: [],
  devDependencies: [],
  registryDependencies: [],
  files: [{ path, type: 'registry:ui' }],
})

describe('styleRegistry', () => {
  it('lists the hand-written items, then the generated ones, under the style homepage', () => {
    const base = { name: 'bje', homepage: 'https://x', items: [{ name: 'cn' }] }
    const next = styleRegistry(base, [item('button', 'Button')], 'vega')
    expect(next).toEqual({
      name: 'bje',
      homepage: 'https://x/vega',
      items: [{ name: 'cn' }, item('button', 'Button')],
    })
    expect(base.items).toEqual([{ name: 'cn' }])
  })

  it('refuses a generated item that shares a hand-written name', () => {
    const base = { homepage: 'https://x', items: [{ name: 'cn' }] }
    expect(() => styleRegistry(base, [item('cn', 'Cn')], 'vega')).toThrow(
      'registry.json: cn is hand-written and generated',
    )
  })

  it('refuses a base registry without a homepage', () => {
    expect(() => styleRegistry({ items: [] }, [], 'vega')).toThrow(
      'registry.json: homepage must be a string',
    )
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
