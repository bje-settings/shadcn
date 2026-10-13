import { describe, expect, it } from 'vitest'
import { builtStyles } from './config.ts'
import { registryBuilds, showcaseBuilds } from './registries.ts'
import { parsed } from './test-support.ts'

describe('registryBuilds', () => {
  it('builds each style from its catalog into its own directory', () => {
    const styles = builtStyles(parsed).map((style) => style.name)
    expect(styles.at(-1), 'a derived style comes last').toBe('frost')
    expect(registryBuilds(parsed, 'out')).toEqual(
      styles.map((style) => ({
        registry: `registry/${style}/registry.json`,
        output: `out/${style}`,
      })),
    )
  })
})

describe('showcaseBuilds', () => {
  it("generates each style's inputs, builds its showcase into its directory, then the root page", () => {
    const styles = builtStyles(parsed).map((style) => style.name)
    expect(styles.at(-1), 'a derived style comes last').toBe('frost')
    expect(styles.length, 'the config lists more than one style').toBeGreaterThan(1)
    expect(showcaseBuilds(parsed, 'public/r')).toEqual([
      ...styles.flatMap((style) => [
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
      // After every style, with the first upstream style's inputs, into the site root.
      {
        command: 'pnpm',
        args: [
          ...['exec', 'vite', 'build', '--config', 'ab/vite.config.ts', '--mode', 'site'],
          ...['--outDir', '../public/r'],
        ],
        env: { AB_STYLE: styles[0] },
      },
    ])
  })
})
