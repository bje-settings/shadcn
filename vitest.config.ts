// Coverage is 100 on all four buckets. 95 is the floor the enterprise Code
// Coverage ruleset holds every repository to; relief is exclusion by file name
// with a stated reason, never a lowered threshold.
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

const mirror = JSON.parse(readFileSync(new URL('./mirror.config.json', import.meta.url), 'utf8'))

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
            [`@/registry/${mirror.namespace}/ui`]: new URL('./registry/ui', import.meta.url)
              .pathname,
          },
          include: ['registry/**/*.test.{ts,tsx}'],
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
      include: ['registry/**/*.{ts,tsx}', 'scripts/**/*.ts'],
      exclude: [
        '**/*.test.{ts,tsx}',
        // The process entry point: wires cli.ts to the real process, fetch
        // and console, and holds no logic of its own.
        'scripts/mirror/main.ts',
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
