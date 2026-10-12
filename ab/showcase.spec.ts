// The showcase renders every preview card the style can render, on upstream's
// own grid: through its own controls and its URL, in every preview block and
// both themes, no card may render its error (data-case-error), the page may
// report none, the cards rendered are exactly those the snapshotted index
// imports less the committed skip list, each as many times as the index
// renders it, and the grid lays them out in upstream's seven columns with a
// gap, a column spanning as many tracks as its col-span says. The header holds
// the bje logo, and a select of every style in the config that requests the
// chosen style's page with the block and theme kept.

import { readFileSync } from 'node:fs'
import { expect, type Page, test } from '@playwright/test'
import { shortStyle } from '../scripts/mirror/config.ts'
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

const snapshot = (block: string) =>
  readFileSync(`${repo}${config.snapshotDir}/preview/${block}/index.tsx`, 'utf8')

// The cards each block should render, in order, from the snapshot, not the
// generated showcase, and how many copies of each: an index can render a card
// once per breakpoint (preview's UIElements).
const expected = (block: string) => {
  const index = snapshot(block)
  return previewCards(block, index)
    .filter(({ name }) => !(name in (skipped[block] ?? {})))
    .map(({ name, component }) => ({
      name,
      copies: index.split(new RegExp(`<${component}[\\s/>]`)).length - 1,
    }))
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
    // Each card in the order it first appears, and as many copies as the
    // index renders.
    const cards = await page
      .locator('[data-card]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-card') as string))
    const want = expected(block)
    const names = want.map(({ name }) => name)
    expect([...new Set(cards)], 'cards rendered').toEqual(names)
    const copies = Object.fromEntries(
      names.map((name) => [name, cards.filter((card) => card === name).length]),
    )
    expect(copies, 'copies of each card').toEqual(
      Object.fromEntries(want.map(({ name, copies }) => [name, copies])),
    )
    const grid = await page.locator('[data-slot="capture-target"]').evaluate((node) => {
      const { gridTemplateColumns, columnGap } = getComputedStyle(node)
      // The columns that span more than one track (preview-02's SavingsTargets).
      const spans = [...node.children].flatMap((child) => {
        const span = /^span (\d+)$/.exec(getComputedStyle(child).gridColumnEnd)
        return span ? [Number(span[1])] : []
      })
      return { columns: gridTemplateColumns.split(' ').length, columnGap, spans }
    })
    expect(grid.columns, "the grid's columns").toBe(7)
    expect(grid.columnGap, "the grid's gap").toMatch(/^[1-9]\d*(\.\d+)?px$/)
    expect(grid.spans, "the grid's wide columns").toEqual(
      [...snapshot(block).matchAll(/\bcol-span-(\d+)\b/g)].map((match) => Number(match[1])),
    )
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
  // The header: the bje logo in the primary color.
  const logo = page.locator('h1').getByRole('img', { name: 'bje' })
  await expect(logo.locator('path')).toHaveAttribute('fill', 'var(--primary)')
  // The select lists every configured style in order, with this one chosen.
  const styles = config.upstream.styles.map(shortStyle)
  const select = page.getByRole('combobox', { name: 'Style' })
  await expect(select.locator('option')).toHaveText(styles)
  expect(
    await select
      .locator('option')
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value)),
    'style options',
  ).toEqual(styles)
  await expect(select).toHaveValue(short)
  // Choosing another style requests its page, keeping the block and theme.
  // Under `pnpm ab:serve` that page does not exist, so the request is checked,
  // not the page.
  const other = styles[(styles.indexOf(short) + 1) % styles.length] as string
  const current = new URL(page.url())
  const requested = page.waitForRequest((request) => request.url().includes(`/${other}/`))
  await page.route(`**/${other}/**`, (route) => route.abort())
  await select.selectOption(other)
  const target = new URL((await requested).url())
  expect(target.pathname).toBe(new URL(`../${other}/`, current).pathname)
  expect(target.searchParams.get('preview'), 'preview kept').toBe(
    current.searchParams.get('preview'),
  )
  expect(target.searchParams.get('theme'), 'theme kept').toBe(current.searchParams.get('theme'))
  // The aborted navigation leaves the showcase page in place.
  await page.goto(`http://localhost:${PORT}/showcase.html`)
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
