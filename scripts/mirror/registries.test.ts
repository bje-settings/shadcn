import { describe, expect, it } from 'vitest'
import { shortStyle } from './config.ts'
import { registryBuilds } from './registries.ts'
import { parsed } from './test-support.ts'

describe('registryBuilds', () => {
  it('builds each style from its catalog into its own directory', () => {
    const styles = parsed.upstream.styles.map(shortStyle)
    expect(registryBuilds(parsed, 'public/r')).toEqual(
      styles.map((style) => ({
        registry: `registry/${style}/registry.json`,
        output: `public/r/${style}`,
      })),
    )
  })
})
