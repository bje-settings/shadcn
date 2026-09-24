// Coverage is 100 on all four buckets. 95 is the floor the enterprise Code
// Coverage ruleset holds every repository to; relief is exclusion by file name
// with a stated reason, never a lowered threshold.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['registry/**/*.test.{ts,tsx}'],
    // A run that collects nothing is not a pass.
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      // Named, not discovered: a configuration that finds its own inputs can
      // find zero of them and still report 100%.
      include: ['registry/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}'],
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
