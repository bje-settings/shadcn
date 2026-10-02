// Coverage is 100 on all four buckets. 95 is the floor the enterprise Code
// Coverage ruleset holds every repository to; relief is exclusion by file name
// with a stated reason, never a lowered threshold.
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { configDefaults, defineConfig, type TestProjectInlineConfiguration } from 'vitest/config'
import { forStyle, parseConfig, shortStyle } from './scripts/mirror/config.ts'
import { pascalCase } from './scripts/mirror/names.ts'

const mirror = parseConfig(
  JSON.parse(readFileSync(new URL('./mirror.config.json', import.meta.url), 'utf8')),
)
// Every style's generated items are tested and covered.
const styles = mirror.upstream.styles.map((style) => forStyle(mirror, style))
const path = (dir: string) => new URL(`./${dir}`, import.meta.url).pathname
const generated = 'scripts/mirror/generated.test.ts'

// Registry items render under jsdom, with CSS modules compiled by Sass and
// class names kept as written, the way a consumer's bundler would resolve
// `styles.x`.
const registry = {
  environment: 'jsdom',
  css: { include: [/\.module\.scss$/], modules: { classNameStrategy: 'non-scoped' } },
} satisfies TestProjectInlineConfiguration['test']

export default defineConfig({
  test: {
    // A run that collects nothing is not a pass.
    passWithNoTests: false,
    projects: [
      {
        extends: true,
        test: {
          name: 'scripts',
          include: ['scripts/**/*.test.ts'],
          exclude: [...configDefaults.exclude, generated],
          environment: 'node',
        },
      },
      // generated.test.ts once per style, so each style's run reports under its
      // own name.
      ...mirror.upstream.styles.map(
        (style): TestProjectInlineConfiguration => ({
          extends: true,
          test: {
            name: `generated/${shortStyle(style)}`,
            include: [generated],
            environment: 'node',
            env: { MIRROR_STYLE: shortStyle(style) },
          },
        }),
      ),
      {
        extends: true,
        test: { ...registry, name: 'registry/lib', include: ['registry/lib/**/*.test.{ts,tsx}'] },
      },
      ...styles.map(
        (config): TestProjectInlineConfiguration => ({
          extends: true,
          test: {
            ...registry,
            name: `registry/${shortStyle(config.upstream.style)}`,
            // Cross-component imports, as mapped in registry/<style>/tsconfig.json.
            alias: {
              [`@/registry/${mirror.namespace}/ui`]: path(config.outputDir),
              [`@/registry/${mirror.namespace}/hooks`]: path(config.hooksDir),
            },
            include: [`${dirname(config.registryFile)}/**/*.test.{ts,tsx}`],
          },
        }),
      ),
    ],
    coverage: {
      provider: 'v8',
      // Named, not discovered: a configuration that finds its own inputs can
      // find zero of them and still report 100%.
      // ab/ is the Playwright A/B harness: exercised by `pnpm ab`, not vitest.
      include: [
        ...styles.map((config) => `${dirname(config.registryFile)}/**/*.{ts,tsx}`),
        'registry/lib/**/*.{ts,tsx}',
        'scripts/**/*.ts',
      ],
      exclude: [
        '**/*.test.{ts,tsx}',
        // Mirrored components with upstream logic no generated test reaches;
        // mirror.config.json gives each reason.
        ...styles.flatMap((config) =>
          Object.keys(config.coverageExclusions).flatMap((item) => {
            const file = pascalCase(item)
            return [`${config.outputDir}/${file}/${file}.tsx`, `${config.hooksDir}/${item}.ts`]
          }),
        ),
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
