import { describe, expect, it } from 'vitest'
import type { RegistryItem } from './component.ts'
import { upsertItems } from './registry.ts'

const item = (name: string, title: string): RegistryItem => ({
  name,
  type: 'registry:ui',
  title,
  dependencies: [],
  devDependencies: [],
  files: [],
})

describe('upsertItems', () => {
  it('replaces items in place and appends new ones', () => {
    const registry = { name: 'bje', items: [{ name: 'cn' }, item('button', 'Old')] }
    const next = upsertItems(registry, [item('button', 'New'), item('card', 'Card')])
    expect(next.name).toBe('bje')
    expect(next.items).toEqual([{ name: 'cn' }, item('button', 'New'), item('card', 'Card')])
    expect(registry.items[1]).toEqual(item('button', 'Old'))
  })
})
