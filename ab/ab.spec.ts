// Screenshots every case on the upstream and ours pages and diffs them with
// pixelmatch. Each worker opens each side once per theme and walks its share
// of cases. The report attaches upstream, ours and diff images for every case.

import { test as base, expect, type Page } from '@playwright/test'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { type Case, cases } from './cases'
import { PORT } from './playwright.config'

type Theme = Case['theme']
type Pages = Record<'upstream' | 'ours', Record<Theme, Page>>

// Errors each open page has reported: runtime exceptions and console errors.
// Any of them fails the case that was running.
const errors = new Map<Page, string[]>()

const test = base.extend<object, { pages: Pages }>({
  pages: [
    async ({ browser }, use) => {
      const open = async (side: keyof Pages, theme: Theme) => {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
        const reported: string[] = []
        errors.set(page, reported)
        page.on('pageerror', (error) => reported.push(error.message))
        page.on('console', (message) => {
          if (message.type() === 'error') reported.push(message.text())
        })
        await page.goto(`http://localhost:${PORT}/${side}.html?theme=${theme}`)
        await page.locator('[data-case]').first().waitFor()
        await page.evaluate(() => document.fonts.ready)
        return page
      }
      const both = async (side: keyof Pages) => ({
        light: await open(side, 'light'),
        dark: await open(side, 'dark'),
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

function target(page: Page, c: Case) {
  return page.locator(`[data-case="${c.id}"] > *`).first()
}

// Whether a state can change how the case's element renders: anything can be
// hovered, but only focusable elements take focus and only form controls
// honour `disabled`. Other combinations would only repeat the rest case.
async function applies(page: Page, c: Case): Promise<boolean> {
  if (c.state === 'rest' || c.state === 'hover') return true
  return target(page, c).evaluate(
    (element, state) =>
      state === 'focus' ? (element as HTMLElement).tabIndex >= 0 : 'disabled' in element,
    c.state,
  )
}

async function capture(page: Page, c: Case): Promise<PNG> {
  const element = target(page, c)
  try {
    if (c.state === 'hover') await element.hover()
    if (c.state === 'focus') {
      // Tab away and back, so the element holds keyboard focus and matches
      // :focus-visible (programmatic focus after mouse use does not).
      await element.focus()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Shift+Tab')
      expect(await element.evaluate((el) => el.matches(':focus-visible'))).toBe(true)
    }
    const wrapper = page.locator(`[data-case="${c.id}"]`)
    return PNG.sync.read(await wrapper.screenshot({ animations: 'disabled', caret: 'hide' }))
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
  test(c.id, async ({ pages }, testInfo) => {
    const upstreamPage = pages.upstream[c.theme]
    const oursPage = pages.ours[c.theme]
    const sides = [upstreamPage, oursPage]
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
  })
}
