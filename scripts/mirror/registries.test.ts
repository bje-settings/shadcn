import { describe, expect, it } from 'vitest'
import { registryBuilds } from './registries.ts'
import { parsed } from './test-support.ts'

describe('registryBuilds', () => {
  it('builds each style from its catalog into its own directory', () => {
    const styles = ['vega', 'luma', 'nova', 'maia', 'lyra', 'mira', 'sera', 'rhea']
    expect(registryBuilds(parsed, 'public/r')).toEqual(
      styles.map((style) => ({
        registry: `registry/${style}/registry.json`,
        output: `public/r/${style}`,
      })),
    )
  })
})
