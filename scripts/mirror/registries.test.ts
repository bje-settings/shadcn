import { describe, expect, it } from 'vitest'
import { shortStyle } from './config.ts'
import { registryBuilds, showcaseBuilds } from './registries.ts'
import { parsed } from './test-support.ts'

describe('registryBuilds', () => {
  it('builds each style from its catalog into its own directory', () => {
    const styles = parsed.upstream.styles.map(shortStyle)
    expect(registryBuilds(parsed, 'out')).toEqual(
      styles.map((style) => ({
        registry: `registry/${style}/registry.json`,
        output: `out/${style}`,
      })),
    )
  })
})

describe('showcaseBuilds', () => {
  it("generates each style's inputs, then builds its showcase into its directory", () => {
    const styles = parsed.upstream.styles.map(shortStyle)
    expect(showcaseBuilds(parsed, 'public/r')).toEqual(
      styles.flatMap((style) => [
        { command: 'pnpm', args: ['mirror:build', style], env: { AB_STYLE: style } },
        {
          command: 'pnpm',
          args: [
            ...['exec', 'vite', 'build', '--config', 'ab/vite.config.ts', '--mode', 'showcase'],
            // From the Vite root, ab/.
            ...['--outDir', `../public/r/${style}`],
          ],
          env: { AB_STYLE: style },
        },
      ]),
    )
  })
})
