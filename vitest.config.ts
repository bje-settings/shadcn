// Coverage is 100 on all four buckets. 95 is the floor the enterprise Code
// Coverage ruleset holds every repository to; relief is exclusion by file name
// with a stated reason, never a lowered threshold.
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'
import { shortStyle } from './scripts/mirror/config.ts'
import { pascalCase } from './scripts/mirror/names.ts'

const mirror = JSON.parse(readFileSync(new URL('./mirror.config.json', import.meta.url), 'utf8'))
// Generated items are tested and covered for the compare style only: every
// style ships the same generated tests, and running each style's would
// multiply CI time while the repository is internal. The others rely on the
// mirror build's own checks.
const style = shortStyle(mirror.upstream.compare)
const dir = (key: 'outputDir' | 'hooksDir') => mirror[key].replaceAll('{style}', style)

export default defineConfig({
  test: {
    // A run that collects nothing is not a pass.
    passWithNoTests: false,
    projects: [
      {
        extends: true,
        test: { name: 'scripts', include: ['scripts/**/*.test.ts'], environment: 'node' },
      },
      {
        extends: true,
        test: {
          name: 'registry',
          // Cross-component imports, as mapped in registry/tsconfig.json.
          alias: {
            [`@/registry/${mirror.namespace}/ui`]: new URL(`./${dir('outputDir')}`, import.meta.url)
              .pathname,
            [`@/registry/${mirror.namespace}/hooks`]: new URL(
              `./${dir('hooksDir')}`,
              import.meta.url,
            ).pathname,
          },
          include: [`registry/${style}/**/*.test.{ts,tsx}`, 'registry/lib/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          // Compile CSS modules with Sass and keep class names as written, the
          // way a consumer's bundler would resolve `styles.x`.
          css: { include: [/\.module\.scss$/], modules: { classNameStrategy: 'non-scoped' } },
        },
      },
    ],
    coverage: {
      provider: 'v8',
      // Named, not discovered: a configuration that finds its own inputs can
      // find zero of them and still report 100%.
      // ab/ is the Playwright A/B harness: exercised by `pnpm ab`, not vitest.
      include: [`registry/${style}/**/*.{ts,tsx}`, 'registry/lib/**/*.{ts,tsx}', 'scripts/**/*.ts'],
      exclude: [
        '**/*.test.{ts,tsx}',
        // Mirrored components with upstream logic no generated test reaches;
        // mirror.config.json gives each reason.
        ...Object.keys(mirror.coverageExclusions ?? {}).flatMap((item) => {
          const file = pascalCase(item)
          return [`${dir('outputDir')}/${file}/${file}.tsx`, `${dir('hooksDir')}/${item}.ts`]
        }),
        // The process entry points: they wire cli.ts and registries.ts to the
        // real process, fetch, console and shadcn CLI, and hold no logic.
        'scripts/mirror/main.ts',
        'scripts/mirror/build.ts',
      ],
      // json-summary feeds the CI guard against an empty report; cobertura
      // feeds actions/upload-code-coverage for the enterprise ruleset.
      reporter: ['text', 'json-summary', 'cobertura'],
      reportsDirectory: 'coverage',
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
})
