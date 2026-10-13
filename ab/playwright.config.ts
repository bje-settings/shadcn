import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { defineConfig } from '@playwright/test'
import { config, port, repo, short } from './style.ts'

export const PORT = port

// The style's hand-written overrides, where a derived style has them.
export const OVERRIDES = `${repo}${dirname(config.registryFile)}/overrides`
// Whether the style ships a frost filter: its overrides hold one. Read from
// the hand-written source, not the build's output, so a build that drops it
// fails frost.spec.ts instead of skipping it.
export const FROST = existsSync(`${OVERRIDES}/ui/FrostFilter/FrostFilter.tsx`)

export default defineConfig({
  testDir: '.',
  // The style's generated tsconfig.json resolves @ab/generated to its inputs.
  tsconfig: `${repo}${config.harnessDir}/tsconfig.json`,
  fullyParallel: true,
  // Playwright defaults to half the CPU cores: one worker on CI's 2-core
  // runner. A case mostly waits (for its DOM to settle), not computes, so
  // more workers than cores still overlap.
  workers: process.env.CI ? 4 : undefined,
  forbidOnly: Boolean(process.env.CI),
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: `report/${short}` }],
    // Read by `pnpm ab:timings`.
    ['json', { outputFile: `results/${short}/report.json` }],
  ],
  outputDir: `results/${short}`,
  projects: [
    {
      name: 'chrome',
      testMatch: ['ab.spec.ts', 'showcase.spec.ts', 'site.spec.ts', 'frost.spec.ts'],
      // Chrome as installed on the machine: GitHub's Ubuntu runners ship it,
      // so CI downloads no browser. Both sides render in the same browser in
      // the same run, so its version does not affect the comparison.
      use: { channel: 'chrome' },
    },
    // The frost fallback is proven where it applies: Firefox and WebKit run
    // frost.spec.ts alone, for a style with a frost filter alone, so no other
    // style's run needs their download.
    ...(FROST
      ? [
          { name: 'firefox', testMatch: 'frost.spec.ts', use: { browserName: 'firefox' as const } },
          { name: 'webkit', testMatch: 'frost.spec.ts', use: { browserName: 'webkit' as const } },
        ]
      : []),
  ],
  webServer: {
    command: `pnpm exec vite --config ab/vite.config.ts --port ${PORT} --strictPort`,
    cwd: '..',
    url: `http://localhost:${PORT}/ours.html`,
    reuseExistingServer: !process.env.CI,
  },
})
