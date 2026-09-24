// Screenshots every case on the upstream and ours pages and diffs them with
// pixelmatch. Each worker opens each side once per theme, starting empty, and
// shows its share of cases one at a time with the gallery's showCase(), so a
// page never holds more than the case under test. An overlay case, whose popup
// portals out of its wrapper, is compared as the whole viewport. The report
// attaches upstream, ours and diff images for every case.

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

// Upstream's examples load avatars and photos from the web. Every such image
// request gets the same local image instead (anything else is aborted), so
// both sides render identical pixels without depending on the network.
const IMAGE = (() => {
  const png = new PNG({ width: 64, height: 64 })
  for (let i = 0; i < png.data.length; i += 4) png.data.set([128, 144, 160, 255], i)
  return PNG.sync.write(png)
})()

async function open(browser: Browser, side: Side, theme: Theme): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  // Only https: the harness itself is served over http.
  await page.route(/^https:\/\//, (route) =>
    route.request().resourceType() === 'image'
      ? route.fulfill({ body: IMAGE, contentType: 'image/png' })
      : route.abort(),
  )
  const reported: string[] = []
  errors.set(page, reported)
  page.on('pageerror', (error) => reported.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') reported.push(message.text())
  })
  // An empty ?case= renders no case until showCase().
  await page.goto(`http://localhost:${PORT}/${side}.html?theme=${theme}&case=`)
  // Interval polling: animation frames are throttled on a busy page.
  await page.waitForFunction(() => 'showCase' in window, undefined, { polling: 100 })
  // Errors while the page loads every module fail the run here, before any
  // case clears them.
  expect(reported, `${side} ${theme} page load`).toEqual([])
  return page
}

// Milliseconds each step of a case took, by step name. Every case reports
// them as a `timing` annotation, which `pnpm ab:timings` summarizes.
type Timings = Record<string, number>

async function timed<T>(timings: Timings, step: string, run: () => Promise<T>): Promise<T> {
  const start = performance.now()
  try {
    return await run()
  } finally {
    timings[step] = Math.round(performance.now() - start)
  }
}

// Shows one case and waits for it to settle: its fonts and images (a Base UI
// avatar swaps its fallback for the image once it loads), its finite
// animations (a popup's open transition) and two more frames, in which Base
// UI moves initial focus and measures positioned popups, then a quiet DOM.
// Returns whether the DOM went quiet before the 3s cap, and each wait's time.
async function show(page: Page, c: Case): Promise<{ settled: boolean; timings: Timings }> {
  const timings: Timings = {}
  await timed(timings, 'render', async () => {
    await page.evaluate((id) => {
      ;(window as Window & { showCase?: (id: string) => void }).showCase?.(id)
    }, c.id)
    await page.locator(`[data-case="${c.id}"]`).waitFor({ state: 'attached' })
  })
  await timed(timings, 'fonts', () => page.evaluate(() => document.fonts.ready))
  await timed(timings, 'networkidle', () => page.waitForLoadState('networkidle'))
  await timed(timings, 'images', () =>
    page
      .locator('img')
      .evaluateAll((images) =>
        Promise.all(images.map((image) => (image as HTMLImageElement).decode().catch(() => {}))),
      ),
  )
  const settle = await page.evaluate(async () => {
    const waits: Record<string, number> = {}
    let start = performance.now()
    const lap = (step: string) => {
      const now = performance.now()
      waits[step] = Math.round(now - start)
      start = now
    }
    // Time-based and finite: a scroll-driven animation (an attachment
    // group's edge fade) or an endless spinner never finishes.
    const finite = document
      .getAnimations()
      .filter(
        (animation) =>
          animation.timeline instanceof DocumentTimeline &&
          animation.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY,
      )
    await Promise.race([
      Promise.all(finite.map((animation) => animation.finished.catch(() => {}))),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ])
    lap('animations')
    for (let frame = 0; frame < 2; frame++) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    lap('frames')
    // Script-driven animation (Recharts grows its bars by rewriting SVG
    // attributes) settles when the DOM stays quiet for 250ms.
    const quiet = await new Promise<boolean>((resolve) => {
      let timer = setTimeout(() => done(true), 250)
      const cap = setTimeout(() => done(false), 3000)
      const observer = new MutationObserver(() => {
        clearTimeout(timer)
        timer = setTimeout(() => done(true), 250)
      })
      observer.observe(document.body, { subtree: true, attributes: true, childList: true })
      function done(quiet: boolean) {
        observer.disconnect()
        clearTimeout(timer)
        clearTimeout(cap)
        resolve(quiet)
      }
    })
    lap('quiet')
    return { quiet, waits }
  })
  return { settled: settle.quiet, timings: { ...timings, ...settle.waits } }
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
    // Opening a worker's pages loads every module of both sides.
    { scope: 'worker', timeout: 120_000 },
  ],
})

// The element a state applies to: the case's data-slot element, anywhere on
// the page (a popup portals out of the case), or else the case's first child.
function target(page: Page, c: Case) {
  if (c.slot === undefined) return page.locator(`[data-case="${c.id}"] > *`).first()
  return page.locator(`[data-slot="${c.slot}"]`).first()
}

// Whether a state can change how the case's element renders: anything with a
// box in the viewport can be hovered, only an element that holds keyboard
// focus when given it (not one hidden in a closed panel) takes focus, and
// only form controls honour `disabled`. Other combinations would only repeat
// the rest case.
async function applies(page: Page, c: Case): Promise<boolean> {
  if (c.state === 'rest') return true
  return target(page, c).evaluate((element, state) => {
    if (state === 'focus') {
      ;(element as HTMLElement).focus({ focusVisible: true })
      const focused = element.matches(':focus-visible')
      ;(element as HTMLElement).blur()
      return focused
    }
    if (state === 'hover') {
      const { width, height, top, left } = element.getBoundingClientRect()
      const inView = top < window.innerHeight && left < window.innerWidth && top + height > 0
      return width > 0 && height > 0 && inView
    }
    return 'disabled' in element
  }, c.state)
}

async function capture(page: Page, c: Case): Promise<PNG> {
  const element = target(page, c)
  try {
    // force: skip actionability checks, which never pass for an element that
    // spins (Spinner) or ignores the pointer (Kbd); only :hover matters here.
    if (c.state === 'hover') await element.hover({ force: true })
    if (c.state === 'focus') {
      // Focus as the keyboard would, so it matches :focus-visible; tabbing
      // would leave a popup's focus trap or move focus into an open popup.
      await element.evaluate((el) => (el as HTMLElement).focus({ focusVisible: true }))
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

// A case checks its own errors; a failed one leaves them for no one else.
test.afterEach(() => {
  for (const reported of errors.values()) reported.splice(0)
})

for (const c of cases) {
  test(c.id, async ({ pages }, testInfo) => {
    const sides = [pages.upstream[c.theme], pages.ours[c.theme]]
    const [upstreamPage, oursPage] = sides as [Page, Page]
    const reported = () => sides.flatMap((page) => errors.get(page) ?? [])
    // Recorded however the case ends: passed, failed or skipped.
    const timings: Record<string, Timings> = { test: {} }
    try {
      // Each case clears its pages' errors when it ends (afterEach), so any
      // here arrived after the previous case finished: nothing reaches the
      // console unaccounted for.
      expect(reported(), 'errors after the previous case').toEqual([])
      const shown = await Promise.all(sides.map((page) => show(page, c)))
      timings.upstream = shown[0]?.timings ?? {}
      timings.ours = shown[1]?.timings ?? {}
      if (shown.some(({ settled }) => !settled)) {
        // Still changing after 3s (an endless animation): compared as it is.
        testInfo.annotations.push({ type: 'unsettled', description: 'DOM still changing after 3s' })
      }
      for (const page of sides) {
        const failed = page.locator(`[data-case="${c.id}"] [data-case-error]`)
        if ((await failed.count()) > 0) {
          throw new Error(`${await failed.getAttribute('data-case-error')}`)
        }
      }
      // A state applies on both sides or on neither; one side alone is a
      // difference in itself.
      const [upstreamApplies, oursApplies] = await timed(timings.test, 'applies', () =>
        Promise.all(sides.map((page) => applies(page, c))),
      )
      expect(oursApplies, `${c.state} applies on ours as on upstream`).toBe(upstreamApplies)
      test.skip(!upstreamApplies, `${c.state} does not apply to this element`)
      // An overlay case's popup must have mounted: two blank viewports match.
      if (c.overlay && c.slot !== undefined) {
        for (const page of sides) await expect(target(page, c)).toBeAttached()
      }
      const [upstream, ours] = await timed(timings.test, 'capture', () =>
        Promise.all([capture(upstreamPage, c), capture(oursPage, c)]),
      )
      const width = Math.max(upstream.width, ours.width)
      const height = Math.max(upstream.height, ours.height)
      const diff = new PNG({ width, height })
      const pixels = await timed(timings.test, 'diff', async () =>
        pixelmatch(
          padTo(upstream, width, height).data,
          padTo(ours, width, height).data,
          diff.data,
          width,
          height,
          { threshold: 0.1 },
        ),
      )
      await timed(timings.test, 'attach', async () => {
        for (const [name, png] of Object.entries({ upstream, ours, diff })) {
          await testInfo.attach(name, { body: PNG.sync.write(png), contentType: 'image/png' })
        }
      })
      expect({ size: `${ours.width}x${ours.height}`, pixels }).toEqual({
        size: `${upstream.width}x${upstream.height}`,
        pixels: 0,
      })
      expect(reported()).toEqual([])
    } finally {
      const description = JSON.stringify({ state: c.state, overlay: c.overlay, ...timings })
      testInfo.annotations.push({ type: 'timing', description })
    }
  })
}
