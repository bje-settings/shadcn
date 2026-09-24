// Screenshots every case on the upstream and ours pages and diffs them with
// pixelmatch. Each worker opens both pages once and walks its share of cases.
// The report attaches upstream, ours and diff images for every case.

import { test as base, expect, type Page } from '@playwright/test'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { type Case, cases } from './cases'
import { PORT } from './playwright.config'

type Pages = { upstream: Page; ours: Page }

const test = base.extend<object, { pages: Pages }>({
  pages: [
    async ({ browser }, use) => {
      const open = async (side: string) => {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
        await page.goto(`http://localhost:${PORT}/${side}.html`)
        await page.locator('[data-case]').first().waitFor()
        await page.evaluate(() => document.fonts.ready)
        return page
      }
      const pages = { upstream: await open('upstream'), ours: await open('ours') }
      await use(pages)
      await Promise.all([pages.upstream.close(), pages.ours.close()])
    },
    { scope: 'worker' },
  ],
})

async function capture(page: Page, c: Case): Promise<PNG> {
  const wrapper = page.locator(`[data-case="${c.id}"]`)
  const target = wrapper.locator(':scope > *').first()
  if (c.state === 'hover') await target.hover()
  if (c.state === 'focus') {
    // Tab away and back, so the element holds keyboard focus and matches
    // :focus-visible (programmatic focus after mouse use does not).
    await target.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
  }
  const png = PNG.sync.read(await wrapper.screenshot({ animations: 'disabled', caret: 'hide' }))
  await page.mouse.move(0, 0)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  return png
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
    const [upstream, ours] = await Promise.all([capture(pages.upstream, c), capture(pages.ours, c)])
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
  })
}
