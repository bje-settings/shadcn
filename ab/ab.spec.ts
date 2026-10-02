// Screenshots every case on the upstream and ours pages and diffs them with
// pixelmatch. Each worker opens each side once per theme, starting empty, and
// shows its share of cases one at a time with the gallery's showCase(), so a
// page never holds more than the case under test. A case is one test: its
// render is compared at rest, then hovered and focused, then rendered
// disabled, each state as a step. An overlay case, whose popup portals out of
// its wrapper, is compared as the whole viewport. The report attaches
// upstream, ours and diff images for every comparison (in CI, every failed
// one), and each case records how long its steps took (`pnpm ab:timings`).

import { type Browser, test as base, expect, type Page } from '@playwright/test'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { type Case, cases, isOverlay } from './cases'
import { PORT } from './playwright.config'

type Side = 'upstream' | 'ours'
type State = 'rest' | 'hover' | 'focus' | 'disabled'
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

// Milliseconds a case spent in each step, by step name, summed over the
// step's runs. Every case reports them as a `timing` annotation, which
// `pnpm ab:timings` summarizes.
type Timings = Record<string, number>

async function timed<T>(timings: Timings, step: string, run: () => Promise<T>): Promise<T> {
  const start = performance.now()
  try {
    return await run()
  } finally {
    timings[step] = (timings[step] ?? 0) + Math.round(performance.now() - start)
  }
}

// Shows one case and waits for it to settle: its fonts and images (a Base UI
// avatar swaps its fallback for the image once it loads), its finite
// animations (a popup's open transition) and two more frames, in which Base
// UI moves initial focus and measures positioned popups, then a quiet DOM.
// Adds each wait's time to `timings`. Returns whether the DOM went quiet
// before the 3s cap.
async function show(page: Page, c: Case, timings: Timings): Promise<boolean> {
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
    // attributes) settles when the DOM stays quiet for 250ms. A DOM that
    // changes in none of the first 100ms is taken as settled: every change
    // measured in this window started within 35ms.
    const quiet = await new Promise<boolean>((resolve) => {
      let timer = setTimeout(() => done(true), 100)
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
  for (const [step, ms] of Object.entries(settle.waits)) timings[step] = (timings[step] ?? 0) + ms
  return settle.quiet
}

// Whether the page's DOM changed since `watch()`: a state that rewrote it (a
// hover that opened a card, a focus that set an attribute) leaves the render
// dirty, and the next state starts from a fresh one.
async function watch(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as Window & { abWatch?: MutationObserver; abDirty?: boolean }
    w.abWatch?.disconnect()
    w.abDirty = false
    w.abWatch = new MutationObserver(() => {
      w.abDirty = true
    })
    w.abWatch.observe(document.body, {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: true,
    })
  })
}

async function dirty(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as Window & { abDirty?: boolean }).abDirty === true)
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
  if (c.kind !== 'fixture' || c.slot === undefined) {
    return page.locator(`[data-case="${c.id}"] > *`).first()
  }
  return page.locator(`[data-slot="${c.slot}"]`).first()
}

// Whether a state can change how the case's element renders: anything with a
// box in the viewport can be hovered, only an element that holds keyboard
// focus when given it (not one hidden in a closed panel) takes focus, and
// only form controls honour `disabled`. Other combinations would only repeat
// the rest case.
async function applies(page: Page, c: Case, state: State): Promise<boolean> {
  if (state === 'rest') return true
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
  }, state)
}

// A screenshot as Playwright encoded it, for the report, and decoded, to diff.
type Shot = { file: Buffer; png: PNG }

async function capture(page: Page, c: Case, state: State): Promise<Shot> {
  const element = target(page, c)
  try {
    // force: skip actionability checks, which never pass for an element that
    // spins (Spinner) or ignores the pointer (Kbd); only :hover matters here.
    if (state === 'hover') await element.hover({ force: true })
    if (state === 'focus') {
      // Focus as the keyboard would, so it matches :focus-visible; tabbing
      // would leave a popup's focus trap or move focus into an open popup.
      await element.evaluate((el) => (el as HTMLElement).focus({ focusVisible: true }))
      expect(await element.evaluate((el) => el.matches(':focus-visible'))).toBe(true)
    }
    const options = { animations: 'disabled', caret: 'hide' } as const
    const shot = isOverlay(c)
      ? await page.screenshot(options)
      : await page.locator(`[data-case="${c.id}"]`).screenshot(options)
    return { file: shot, png: PNG.sync.read(shot) }
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
    const sides = [pages.upstream[c.theme], pages.ours[c.theme]] as [Page, Page]
    const reported = () => sides.flatMap((page) => errors.get(page) ?? [])
    // Recorded however the case ends: passed or failed.
    const timings: Record<Side | 'test', Timings> = { upstream: {}, ours: {}, test: {} }
    const compared: State[] = []
    let shows = 0

    // Shows a render on both sides, fails on its render error, and watches
    // it for changes from here on.
    const showBoth = async (render: Case) => {
      shows++
      const settled = await Promise.all([
        show(sides[0], render, timings.upstream),
        show(sides[1], render, timings.ours),
      ])
      if (settled.includes(false) && !testInfo.annotations.some((a) => a.type === 'unsettled')) {
        // Still changing after 3s (an endless animation): compared as it is.
        testInfo.annotations.push({ type: 'unsettled', description: 'DOM still changing after 3s' })
      }
      for (const page of sides) {
        const failed = page.locator(`[data-case="${render.id}"] [data-case-error]`)
        if ((await failed.count()) > 0) {
          throw new Error(`${await failed.getAttribute('data-case-error')}`)
        }
      }
      await Promise.all(sides.map(watch))
    }

    // A state applies on both sides or on neither; one side alone is a
    // difference in itself.
    const appliesBoth = async (render: Case, state: State) => {
      const [upstream, ours] = await timed(timings.test, 'applies', () =>
        Promise.all(sides.map((page) => applies(page, render, state))),
      )
      expect(ours, `${state} applies on ours as on upstream`).toBe(upstream)
      return upstream
    }

    // Compares one state of the render on show, if it applies.
    const compare = (render: Case, state: State) =>
      test.step(state, async () => {
        if (!(await appliesBoth(render, state))) return
        // An overlay case's popup must have mounted: two blank viewports match.
        if (render.kind === 'fixture' && render.overlay && render.slot !== undefined) {
          for (const page of sides) await expect(target(page, render)).toBeAttached()
        }
        const [upstreamShot, oursShot] = await timed(timings.test, 'capture', () =>
          Promise.all(sides.map((page) => capture(page, render, state))),
        )
        const [upstream, ours] = [upstreamShot.png, oursShot.png]
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
        const matches =
          pixels === 0 && upstream.width === ours.width && upstream.height === ours.height
        // CI's report keeps only the comparisons that failed; a local one
        // keeps every comparison, to browse.
        if (!matches || !process.env.CI) {
          await timed(timings.test, 'attach', async () => {
            // The screenshots as taken: only the diff needs encoding.
            const files = {
              upstream: upstreamShot.file,
              ours: oursShot.file,
              diff: PNG.sync.write(diff),
            }
            for (const [name, body] of Object.entries(files)) {
              await testInfo.attach(`${state} ${name}`, { body, contentType: 'image/png' })
            }
          })
        }
        compared.push(state)
        // Soft: the case's other states are still compared.
        expect
          .soft({ size: `${ours.width}x${ours.height}`, pixels }, `${state} matches`)
          .toEqual({ size: `${upstream.width}x${upstream.height}`, pixels: 0 })
        expect(reported(), `errors while comparing ${state}`).toEqual([])
      })

    try {
      // Each case clears its pages' errors when it ends (afterEach), so any
      // here arrived after the previous case finished: nothing reaches the
      // console unaccounted for.
      expect(reported(), 'errors after the previous case').toEqual([])
      await showBoth(c)
      await compare(c, 'rest')
      if (c.kind === 'fixture' && c.interactive) {
        for (const state of ['hover', 'focus'] as const) {
          // Each state starts from an untouched render.
          if ((await Promise.all(sides.map(dirty))).includes(true)) await showBoth(c)
          await compare(c, state)
        }
      }
      // Only form controls honour `disabled`, whichever way they render, so
      // the disabled render is shown only when this one's element takes it.
      if (c.kind === 'fixture' && c.disabled && (await appliesBoth(c, 'disabled'))) {
        await showBoth(c.disabled)
        await compare(c.disabled, 'disabled')
      }
    } finally {
      const description = JSON.stringify({
        overlay: isOverlay(c),
        interactive: c.kind === 'fixture' && c.interactive,
        compared,
        shows,
        ...timings,
      })
      testInfo.annotations.push({ type: 'timing', description })
    }
  })
}
