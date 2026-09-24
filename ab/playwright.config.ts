import { defineConfig } from '@playwright/test'

export const PORT = 4400

export default defineConfig({
  testDir: '.',
  testMatch: 'ab.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'report' }],
    // Read by `pnpm ab:timings`.
    ['json', { outputFile: 'results/report.json' }],
  ],
  outputDir: 'results',
  // Chrome as installed on the machine: GitHub's Ubuntu runners ship it, so CI
  // downloads no browser. Both sides render in the same browser in the same
  // run, so its version does not affect the comparison.
  use: { channel: 'chrome' },
  webServer: {
    command: `pnpm exec vite --config ab/vite.config.ts --port ${PORT} --strictPort`,
    cwd: '..',
    url: `http://localhost:${PORT}/ours.html`,
    reuseExistingServer: !process.env.CI,
  },
})
