import { describe, expect, it } from 'vitest'
import { registryBuilds } from './registries.ts'
import { parsed } from './test-support.ts'

describe('registryBuilds', () => {
  it('builds each style from its catalog into its own directory', () => {
    expect(registryBuilds(parsed, 'public/r')).toEqual([
      { registry: 'registry/vega/registry.json', output: 'public/r/vega' },
      { registry: 'registry/luma/registry.json', output: 'public/r/luma' },
    ])
  })
})
