// The showcase renders every preview card the style can render, on upstream's
// own grid: through its own controls and its URL, in every preview block and
// both themes, no card may render its error (data-case-error), the page may
// report none, the cards rendered are exactly those the snapshotted index
// imports less the committed skip list, and the grid lays them out in
// upstream's seven columns with a gap.

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

// The theme font's title, as its snapshotted font item names it (Inter).
const fontTitle: string = JSON.parse(
  readFileSync(
    `${repo}${config.snapshotDir}/${config.upstream.style}/font-${config.theme.font}.json`,
    'utf8',
  ),
).title

// 01, 02, ...: the switcher's label for the block at `index`.
const label = (index: number) => String(index + 1).padStart(2, '0')

// The cards each block should render, in order, from the snapshot, not the
// generated showcase.
const expected = (block: string) => {
  const index = readFileSync(`${repo}${config.snapshotDir}/preview/${block}/index.tsx`, 'utf8')
  return previewCards(block, index)
    .map(({ name }) => name)
    .filter((name) => !(name in (skipped[block] ?? {})))
}

async function check(page: Page, errors: string[], index: number, theme: 'light' | 'dark') {
  const block = config.preview.blocks[index] as string
  await test.step(`${label(index)} (${block}) ${theme}`, async () => {
    await expect(page.locator('main')).toHaveAttribute('data-showcase', block)
    const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
    expect(dark, '.dark on <html>').toBe(theme === 'dark')
    await page.locator('[data-card]').first().waitFor()
    const failed = await page
      .locator('[data-case-error]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-case-error')))
    expect(failed, 'cards that threw').toEqual([])
    // An index can render a card twice, one copy per breakpoint (preview's
    // UIElements): each counts once, where it first appears.
    const cards = await page
      .locator('[data-card]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-card')))
    const names = expected(block)
    expect([...new Set(cards)], 'cards rendered').toEqual(names)
    const grid = await page.locator('[data-slot="capture-target"]').evaluate((node) => {
      const { gridTemplateColumns, columnGap } = getComputedStyle(node)
      return { columns: gridTemplateColumns.split(' ').length, columnGap }
    })
    expect(grid.columns, "the grid's columns").toBe(7)
    expect(grid.columnGap, "the grid's gap").toMatch(/^[1-9]\d*(\.\d+)?px$/)
    // The /create stubs return the style and the theme's font: style-overview
    // names both ("Vega - Inter").
    if (names.includes('style-overview')) {
      await expect(page.locator('[data-card="style-overview"]')).toContainText(
        `${pascalCase(short)} - ${fontTitle}`,
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
  const preview = (index: number) => page.getByRole('button', { name: label(index), exact: true })
  for (const theme of ['light', 'dark'] as const) {
    for (const index of config.preview.blocks.keys()) {
      await preview(index).click()
      await check(page, errors, index, theme)
    }
    await page.getByRole('button', { name: theme === 'light' ? 'Dark' : 'Light' }).click()
  }
  // ?preview= and ?theme= open a block and the dark theme directly.
  const last = config.preview.blocks.length - 1
  await page.goto(`http://localhost:${PORT}/showcase.html?preview=${label(last)}&theme=dark`)
  await check(page, errors, last, 'dark')
})
