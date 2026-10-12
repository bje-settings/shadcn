// The site's root page: a card per style the config builds, in its order, each
// titled with the style's name and linking to the style's showcase beside the
// page. Its header's heading is the bje logo alone, the style select shows no
// style chosen and lists every style after its prompt, there is no preview
// switcher, and choosing a style requests that style's page with the theme
// kept and no block. The theme applies to the page, and its toggle switches it
// and keeps it in the URL. The site builds the root page with the first style,
// so only that style's run checks it.

import { expect, test } from '@playwright/test'
import { shortStyle } from '../scripts/mirror/config.ts'
import { pascalCase } from '../scripts/mirror/names.ts'
import { PORT } from './playwright.config'
import { config, short } from './style.ts'

const styles = config.upstream.styles.map(shortStyle)
const first = styles[0]

test.skip(short !== first, `the root page builds with ${first}, not ${short}`)

test('site root', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  expect(styles.length, 'the config lists more than one style').toBeGreaterThan(1)
  // Open in the dark theme, so a selection that reset it is caught.
  await page.goto(`http://localhost:${PORT}/site.html?theme=dark`)
  const dark = () => page.evaluate(() => document.documentElement.classList.contains('dark'))
  expect(await dark(), '.dark on <html>').toBe(true)
  // A card per style, in the config's order, each a link to its showcase.
  const cards = page.locator('main a')
  await expect(cards).toHaveCount(styles.length)
  await expect(cards.locator('[data-slot="card-title"]')).toHaveText(styles.map(pascalCase))
  expect(
    await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href'))),
    'card links',
  ).toEqual(styles.map((style) => `./${style}/`))
  // The heading is the logo alone.
  await expect(page.getByRole('heading', { level: 1 })).toHaveAccessibleName('bje')
  await expect(page.locator('h1').getByRole('img', { name: 'bje' })).toBeVisible()
  // No preview switcher, hidden or not.
  await expect(page.locator('nav')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '01', exact: true })).toHaveCount(0)
  // The select shows its prompt, no style, and lists every style after it.
  const select = page.getByRole('combobox', { name: 'Style' })
  await expect(select).toHaveValue('')
  await expect(select.locator('option:checked')).toHaveText('Choose a style')
  await expect(select.locator('option')).toHaveText(['Choose a style', ...styles])
  expect(
    await select
      .locator('option')
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value)),
    'style options',
  ).toEqual(['', ...styles])
  await expect(select.locator('option').first()).toBeDisabled()
  // The toggle switches the theme and keeps it in the URL, both ways; the page
  // ends dark again, so the selection below must keep a non-default theme.
  for (const [button, theme] of [
    ['Light', 'light'],
    ['Dark', 'dark'],
  ] as const) {
    await page.getByRole('button', { name: button, exact: true }).click()
    expect(await dark(), `.dark on <html> in ${theme}`).toBe(theme === 'dark')
    expect(new URL(page.url()).searchParams.get('theme'), 'theme in the URL').toBe(theme)
  }
  // Choosing a style requests its page, keeping the theme and adding no block.
  // Under `pnpm ab:serve` there is no style page at /<style>/ (it exists only
  // in the built site), so the navigation is aborted and the request checked.
  const other = styles[styles.length - 1] as string
  const current = new URL(page.url())
  await page.route(`**/${other}/**`, (route) => route.abort())
  const [request] = await Promise.all([
    page.waitForRequest(
      (request) =>
        request.isNavigationRequest() &&
        request.frame() === page.mainFrame() &&
        request.url().includes(`/${other}/`),
    ),
    select.selectOption(other),
  ])
  const target = new URL(request.url())
  expect(target.pathname).toBe(new URL(`./${other}/`, current).pathname)
  expect(target.searchParams.get('theme'), 'theme kept').toBe('dark')
  expect(target.searchParams.has('preview'), 'no block').toBe(false)
  expect(errors, 'page errors').toEqual([])
})
