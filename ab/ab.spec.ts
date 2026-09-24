// Screenshots every case on the upstream and ours pages and diffs them with
// pixelmatch. Each worker opens each side once per theme and walks its share
// of cases; an overlay case, whose popup portals out of its wrapper, opens its
// own page on each side instead and compares the viewport. The report attaches
// upstream, ours and diff images for every case.

import { type Browser, test as base, expect, type Page } from '@playwright/test'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { type Case, cases } from './cases'
import { PORT } from './playwright.config'

type Side = 'upstream' | 'ours'
type Theme = Case['theme']
type Pages = Record<Side, Record<Theme, Page>>

// Errors each open page has reported: runtime exceptions and console errors.
// Any of them fails the case that was running.
const errors = new Map<Page, string[]>()

async function open(browser: Browser, side: Side, theme: Theme, only?: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const reported: string[] = []
  errors.set(page, reported)
  page.on('pageerror', (error) => reported.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') reported.push(message.text())
  })
  const query = only === undefined ? '' : `&case=${encodeURIComponent(only)}`
  await page.goto(`http://localhost:${PORT}/${side}.html?theme=${theme}${query}`)
  await page.locator('[data-case]').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
  return page
}

const test = base.extend<object, { pages: Pages }>({
  pages: [
    async ({ browser }, use) => {
      const both = async (side: Side) => ({
        light: await open(browser, side, 'light'),
        dark: await open(browser, side, 'dark'),
      })
      const pages = { upstream: await both('upstream'), ours: await both('ours') }
      await use(pages)
      for (const side of Object.values(pages)) {
        await Promise.all(Object.values(side).map((page) => page.close()))
      }
    },
    { scope: 'worker' },
  ],
})

// The element a state applies to: the case's data-slot element, anywhere on
// an overlay case's page, or else the case's first child.
function target(page: Page, c: Case) {
  if (c.slot === undefined) return page.locator(`[data-case="${c.id}"] > *`).first()
  const scope = c.overlay ? '' : `[data-case="${c.id}"] `
  return page.locator(`${scope}[data-slot="${c.slot}"]`).first()
}

// Whether a state can change how the case's element renders: anything with a
// box can be hovered, but only focusable elements take focus and only form
// controls honour `disabled`. Other combinations would only repeat the rest
// case.
async function applies(page: Page, c: Case): Promise<boolean> {
  if (c.state === 'rest') return true
  return target(page, c).evaluate((element, state) => {
    if (state === 'hover') {
      const { width, height } = element.getBoundingClientRect()
      return width > 0 && height > 0
    }
    return state === 'focus' ? (element as HTMLElement).tabIndex >= 0 : 'disabled' in element
  }, c.state)
}

async function capture(page: Page, c: Case): Promise<PNG> {
  const element = target(page, c)
  try {
    // force: skip actionability checks, which never pass for an element that
    // spins (Spinner) or ignores the pointer (Kbd); only :hover matters here.
    if (c.state === 'hover') await element.hover({ force: true })
    if (c.state === 'focus') {
      // Tab away and back, so the element holds keyboard focus and matches
      // :focus-visible (programmatic focus after mouse use does not).
      await element.focus()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Shift+Tab')
      expect(await element.evaluate((el) => el.matches(':focus-visible'))).toBe(true)
    }
    const options = { animations: 'disabled', caret: 'hide' } as const
    const shot = c.overlay
      ? await page.screenshot(options)
      : await page.locator(`[data-case="${c.id}"]`).screenshot(options)
    return PNG.sync.read(shot)
  } finally {
    await page.mouse.move(0, 0)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  }
}

function padTo(png: PNG, width: number, height: number): PNG {
  if (png.width === width && png.height === height) return png
  const out = new PNG({ width, height })
  PNG.bitblt(png, out, 0, 0, png.width, png.height, 0, 0)
  return out
}

test.describe.configure({ mode: 'parallel' })

for (const c of cases) {
  test(c.id, async ({ pages, browser }, testInfo) => {
    const own = c.overlay
      ? await Promise.all([
          open(browser, 'upstream', c.theme, c.id),
          open(browser, 'ours', c.theme, c.id),
        ])
      : undefined
    const sides = own ?? [pages.upstream[c.theme], pages.ours[c.theme]]
    const [upstreamPage, oursPage] = sides as [Page, Page]
    try {
      for (const page of sides) {
        const failed = page.locator(`[data-case="${c.id}"] [data-case-error]`)
        if ((await failed.count()) > 0) {
          throw new Error(`${await failed.getAttribute('data-case-error')}`)
        }
      }
      test.skip(!(await applies(upstreamPage, c)), `${c.state} does not apply to this element`)
      for (const page of sides) errors.get(page)?.splice(0)
      const [upstream, ours] = await Promise.all([capture(upstreamPage, c), capture(oursPage, c)])
      const width = Math.max(upstream.width, ours.width)
      const height = Math.max(upstream.height, ours.height)
      const diff = new PNG({ width, height })
      const pixels = pixelmatch(
        padTo(upstream, width, height).data,
        padTo(ours, width, height).data,
        diff.data,
        width,
        height,
        { threshold: 0.1 },
      )
      for (const [name, png] of Object.entries({ upstream, ours, diff })) {
        await testInfo.attach(name, { body: PNG.sync.write(png), contentType: 'image/png' })
      }
      expect({ size: `${ours.width}x${ours.height}`, pixels }).toEqual({
        size: `${upstream.width}x${upstream.height}`,
        pixels: 0,
      })
      expect(sides.flatMap((page) => errors.get(page) ?? [])).toEqual([])
    } finally {
      await Promise.all((own ?? []).map((page) => page.close()))
    }
  })
}
