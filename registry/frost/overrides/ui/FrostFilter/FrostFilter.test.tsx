import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FROST_FILTER_ID,
  FrostFilter,
  frostSurface,
  REFRACTION_ATTRIBUTE,
  refracts,
  startSurfaces,
} from './FrostFilter'
import styles from './FrostFilter.module.scss'
import { surfaceMaps } from './maps'

const brands = (...names: string[]) =>
  ({ userAgentData: { brands: names.map((brand) => ({ brand })) } }) as unknown as Navigator

// jsdom lays nothing out, observes no size and draws no canvas: each is
// stood in for, and every observer made is kept, to fire it by hand.
const resizers: { callback: ResizeObserverCallback; observed: Set<Element>; off: boolean }[] = []
class FakeResizeObserver {
  entry: (typeof resizers)[number]
  constructor(callback: ResizeObserverCallback) {
    this.entry = { callback, observed: new Set(), off: false }
    resizers.push(this.entry)
  }
  observe(element: Element) {
    this.entry.observed.add(element)
  }
  unobserve(element: Element) {
    this.entry.observed.delete(element)
  }
  disconnect() {
    this.entry.off = true
  }
}
const resize = (...elements: Element[]) =>
  resizers.at(-1)?.callback(
    elements.map((target) => ({ target }) as ResizeObserverEntry),
    {} as ResizeObserver,
  )

// What each element's computed style reports, by property.
const computed = new Map<Element, Record<string, string>>()
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))

function surface(w: number, h: number, filter = `url("#${FROST_FILTER_ID}")`, radius = '12px') {
  const element = document.createElement('div')
  element.dataset.slot = 'popover-content'
  Object.defineProperty(element, 'offsetWidth', { configurable: true, value: w })
  Object.defineProperty(element, 'offsetHeight', { configurable: true, value: h })
  computed.set(element, { 'backdrop-filter': filter, borderTopLeftRadius: radius })
  document.body.append(element)
  return element
}
const resized = (element: HTMLElement, w: number) =>
  Object.defineProperty(element, 'offsetWidth', { configurable: true, value: w })
const ownFilters = () => document.querySelectorAll(`[data-slot="frost-surfaces"] filter`)

beforeEach(() => {
  resizers.length = 0
  computed.clear()
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  vi.spyOn(window, 'getComputedStyle').mockImplementation(
    (element) =>
      ({
        ...computed.get(element),
        getPropertyValue: (name: string) => computed.get(element)?.[name] ?? '',
      }) as unknown as CSSStyleDeclaration,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: () => {},
      }) as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.replaceChildren()
  document.documentElement.removeAttribute(REFRACTION_ATTRIBUTE)
})

describe('FrostFilter', () => {
  it('renders the shared filter the frost surfaces name, once, hidden', () => {
    render(<FrostFilter />)
    const filters = document.querySelectorAll('filter')
    expect(filters).toHaveLength(1)
    expect(filters[0]?.id).toBe('bje-frost-filter')
    expect(FROST_FILTER_ID).toBe('bje-frost-filter')
    const svg = document.querySelector('svg')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(svg?.getAttribute('class')).toBe(styles.frostFilter)
    const primitives = [...(filters[0]?.children ?? [])]
    expect(primitives.map((primitive) => primitive.tagName)).toEqual([
      'feTurbulence',
      'feGaussianBlur',
      'feDisplacementMap',
      'feGaussianBlur',
    ])
    expect(primitives[2]?.getAttribute('scale')).toBe('16')
    expect(primitives[3]?.getAttribute('stdDeviation')).toBe('4')
    expect(primitives[3]?.getAttribute('edgeMode')).toBe('duplicate')
  })

  it("marks the root where the refraction renders, builds each surface's filter, and undoes both on unmount", () => {
    vi.stubGlobal('navigator', brands('Not A(Brand', 'Chromium'))
    const popover = surface(200, 100)
    const { unmount } = render(<FrostFilter />)
    expect(document.documentElement.hasAttribute(REFRACTION_ATTRIBUTE)).toBe(true)
    expect(ownFilters()).toHaveLength(1)
    unmount()
    expect(document.documentElement.hasAttribute(REFRACTION_ATTRIBUTE)).toBe(false)
    expect(ownFilters()).toHaveLength(0)
    expect(popover.style.getPropertyValue('backdrop-filter')).toBe('')
  })

  it('leaves the root unmarked, and builds nothing, where it does not', () => {
    vi.stubGlobal('navigator', brands('Some Browser'))
    surface(200, 100)
    render(<FrostFilter />)
    expect(document.documentElement.hasAttribute(REFRACTION_ATTRIBUTE)).toBe(false)
    expect(document.querySelector('[data-slot="frost-surfaces"]')).toBeNull()
  })

  it('exports the frost surface class', () => {
    expect(frostSurface).toBe(styles.frostSurface)
  })
})

describe('startSurfaces', () => {
  it('gives each frost surface its own filter, sized to it, after the shared one', () => {
    const popover = surface(200, 100)
    const stop = startSurfaces()
    const [filter] = ownFilters()
    const id = `${FROST_FILTER_ID}-0`
    expect(filter?.id).toBe(id)
    expect(filter?.getAttribute('width')).toBe('200')
    expect(filter?.getAttribute('height')).toBe('100')
    expect(filter?.getAttribute('filterUnits')).toBe('userSpaceOnUse')
    expect([...(filter?.children ?? [])].map((primitive) => primitive.tagName)).toEqual([
      'feImage',
      'feDisplacementMap',
      'feImage',
      'feBlend',
    ])
    // The bend reaches 1.5rem: 24px either way at the default 16px.
    expect(filter?.children[1]?.getAttribute('scale')).toBe('48')
    expect(filter?.children[0]?.getAttribute('href')).toBe('data:image/png;base64,')
    expect(popover.style.getPropertyValue('backdrop-filter')).toBe(
      `url(#${FROST_FILTER_ID}) url(#${id}) var(--frost-saturate)`,
    )
    expect(resizers[0]?.observed.has(popover)).toBe(true)
    stop()
  })

  it('measures the bend in the root font size', () => {
    computed.set(document.documentElement, { fontSize: '20px' })
    surface(200, 100)
    const stop = startSurfaces()
    expect(ownFilters()[0]?.children[1]?.getAttribute('scale')).toBe('60')
    stop()
  })

  it('treats a missing corner radius as square', () => {
    const square = surface(40, 40, `url(#${FROST_FILTER_ID})`, '')
    const stop = startSurfaces()
    expect(square.style.getPropertyValue('backdrop-filter')).toContain('url(#bje-frost-filter-0)')
    stop()
  })

  it('leaves alone what the frost CSS does not refract, and what is too small to bend', () => {
    const blurred = surface(200, 100, 'blur(14px)')
    const tiny = surface(3, 100)
    const stop = startSurfaces()
    expect(ownFilters()).toHaveLength(0)
    expect(blurred.style.getPropertyValue('backdrop-filter')).toBe('')
    expect(tiny.style.getPropertyValue('backdrop-filter')).toBe('')
    stop()
  })

  it('rebuilds a surface that resizes, under the same id, and only then', () => {
    const popover = surface(200, 100)
    const stop = startSurfaces()
    const first = ownFilters()[0]
    resize(popover)
    expect(ownFilters()[0]).toBe(first)
    resized(popover, 240)
    resize(popover)
    expect(ownFilters()).toHaveLength(1)
    expect(ownFilters()[0]).not.toBe(first)
    expect(ownFilters()[0]?.id).toBe(first?.id)
    expect(ownFilters()[0]?.getAttribute('width')).toBe('240')
    stop()
  })

  it('builds a popup that opens, once per frame, and drops one that closes', async () => {
    const stop = startSurfaces()
    expect(ownFilters()).toHaveLength(0)
    const popover = surface(200, 100)
    surface(120, 60)
    await frame()
    expect(ownFilters()).toHaveLength(2)
    popover.remove()
    await frame()
    expect(ownFilters()).toHaveLength(1)
    expect(resizers[0]?.observed.has(popover)).toBe(false)
    stop()
  })

  it('scans once for changes that arrive apart within one frame', async () => {
    const stop = startSurfaces()
    const frames = vi.spyOn(window, 'requestAnimationFrame')
    surface(200, 100)
    await Promise.resolve()
    surface(120, 60)
    await Promise.resolve()
    expect(frames).toHaveBeenCalledTimes(1)
    await frame()
    expect(ownFilters()).toHaveLength(2)
    stop()
  })

  it('caps the corner radius at half the shorter side', () => {
    const images: Uint8ClampedArray[] = []
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () =>
        ({
          createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
          putImageData: (image: ImageData) => images.push(image.data as Uint8ClampedArray),
        }) as unknown as CanvasRenderingContext2D,
    )
    // A pill: maia's button radius outruns its height.
    surface(120, 36, `url(#${FROST_FILTER_ID})`, '999px')
    const stop = startSurfaces()
    expect(images[0]).toEqual(surfaceMaps(120, 36, 18, 16).displacement)
    stop()
  })

  it('builds a surface the frost CSS reaches by an attribute, and one with the frostSurface class', async () => {
    const stop = startSurfaces()
    const popover = surface(200, 100, 'none')
    await frame()
    expect(ownFilters()).toHaveLength(0)
    computed.set(popover, { 'backdrop-filter': `url(#${FROST_FILTER_ID})` })
    popover.setAttribute('data-open', '')
    await frame()
    expect(popover.style.getPropertyValue('backdrop-filter')).toContain('url(#bje-frost-filter-0)')
    const own = surface(200, 100)
    own.removeAttribute('data-slot')
    own.className = frostSurface as string
    await frame()
    expect(own.style.getPropertyValue('backdrop-filter')).toContain('url(#bje-frost-filter-1)')
    stop()
  })

  it('drops a surface the frost CSS no longer reaches, and puts it back to its CSS', async () => {
    const button = surface(200, 100)
    const stop = startSurfaces()
    expect(ownFilters()).toHaveLength(1)
    // A variant without frost: its CSS, read without the inline filter, has none.
    computed.set(button, { 'backdrop-filter': 'none' })
    button.className = 'ghost'
    await frame()
    expect(ownFilters()).toHaveLength(0)
    expect(button.style.getPropertyValue('backdrop-filter')).toBe('')
    expect(resizers[0]?.observed.has(button)).toBe(false)
    stop()
  })

  it('reads the CSS without its own inline filter, and keeps a surface that is still frost', async () => {
    const popover = surface(200, 100)
    const stop = startSurfaces()
    const reads: string[] = []
    vi.mocked(window.getComputedStyle).mockImplementation(
      (element) =>
        ({
          ...computed.get(element),
          getPropertyValue: (name: string) => {
            if (element === popover) reads.push(popover.style.getPropertyValue('backdrop-filter'))
            return computed.get(element)?.[name] ?? ''
          },
        }) as unknown as CSSStyleDeclaration,
    )
    popover.className = 'open'
    await frame()
    expect(reads).toEqual([''])
    expect(popover.style.getPropertyValue('backdrop-filter')).toBe(
      `url(#${FROST_FILTER_ID}) url(#${FROST_FILTER_ID}-0) var(--frost-saturate)`,
    )
    stop()
  })

  it('takes its filter off a surface that leaves the page', async () => {
    const popover = surface(200, 100)
    const stop = startSurfaces()
    popover.remove()
    await frame()
    expect(popover.style.getPropertyValue('backdrop-filter')).toBe('')
    stop()
  })

  it('stops observing, cancels a pending scan, and puts every surface back on cleanup', async () => {
    const popover = surface(200, 100)
    const stop = startSurfaces()
    surface(120, 60)
    // A scan is queued for the next frame; cleanup cancels it.
    await Promise.resolve()
    stop()
    await frame()
    expect(ownFilters()).toHaveLength(0)
    expect(document.querySelector('[data-slot="frost-surfaces"]')).toBeNull()
    expect(popover.style.getPropertyValue('backdrop-filter')).toBe('')
    expect(resizers[0]?.off).toBe(true)
  })
})

describe('refracts', () => {
  it('is true in Chromium alone', () => {
    expect(refracts(brands('Google Chrome', 'Chromium'))).toBe(true)
    expect(refracts(brands('Some Browser'))).toBe(false)
    expect(refracts({} as Navigator)).toBe(false)
    expect(refracts({ userAgentData: {} } as unknown as Navigator)).toBe(false)
  })
})
