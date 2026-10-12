// The showcase renders every preview card the style can render: through its
// own controls, in every preview block and both themes, no card may render its
// error (data-case-error), the page may report none, and the cards rendered
// are exactly those the snapshotted index imports less the committed skip list.

import { readFileSync } from 'node:fs'
import { expect, type Page, test } from '@playwright/test'
import { pascalCase } from '../scripts/mirror/names.ts'
import { previewCards } from '../scripts/mirror/preview.ts'
import { PORT } from './playwright.config'
import { config, repo, short } from './style.ts'

// A 1x1 grey PNG.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

const skipped: Record<string, Record<string, string[]>> = JSON.parse(
  readFileSync(`${repo}ab/skipped-cards/${short}.json`, 'utf8'),
)

// The cards each block should render, in order, from the snapshot, not the
// generated map.
const expected = (block: string) => {
  const index = readFileSync(`${repo}${config.snapshotDir}/preview/${block}/index.tsx`, 'utf8')
  return previewCards(block, index)
    .map(({ name }) => name)
    .filter((name) => !(name in (skipped[block] ?? {})))
}

async function check(page: Page, errors: string[], index: number, theme: 'light' | 'dark') {
  const block = config.preview.blocks[index] as string
  await test.step(`${String(index + 1).padStart(2, '0')} (${block}) ${theme}`, async () => {
    await expect(page.locator('main')).toHaveAttribute('data-showcase', block)
    const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
    expect(dark, '.dark on <html>').toBe(theme === 'dark')
    await page.locator('[data-card]').first().waitFor()
    const failed = await page
      .locator('[data-case-error]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-case-error')))
    expect(failed, 'cards that threw').toEqual([])
    const cards = await page
      .locator('[data-card]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-card')))
    const names = expected(block)
    expect(cards, 'cards rendered').toEqual(names)
    // The /create stubs return the style and the theme's font: style-overview
    // names both ("Vega - Inter").
    if (names.includes('style-overview')) {
      await expect(page.locator('[data-card="style-overview"]')).toContainText(
        new RegExp(`${pascalCase(short)} - \\S`),
      )
    }
    expect(errors, 'page errors').toEqual([])
  })
}

test(`showcase ${short}`, async ({ page }) => {
  expect(config.preview.blocks.length).toBeGreaterThan(0)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  // Upstream's cards load avatars from the web: each gets one local image,
  // and anything else is refused, so the run needs no network.
  await page.route(/^https:\/\//, (route) =>
    route.request().resourceType() === 'image'
      ? route.fulfill({ body: PIXEL, contentType: 'image/png' })
      : route.abort(),
  )
  await page.goto(`http://localhost:${PORT}/showcase.html`)
  await expect(page.locator('h1')).toHaveText(`@bje ${short}`)
  const preview = (index: number) =>
    page.getByRole('button', { name: String(index + 1).padStart(2, '0'), exact: true })
  for (const theme of ['light', 'dark'] as const) {
    for (const index of config.preview.blocks.keys()) {
      await preview(index).click()
      await check(page, errors, index, theme)
    }
    await page.getByRole('button', { name: theme === 'light' ? 'Dark' : 'Light' }).click()
  }
})
