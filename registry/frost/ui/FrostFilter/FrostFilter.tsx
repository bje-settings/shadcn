// The frost style's refraction. Mount <FrostFilter /> once, at the app's root.
// It renders the filter every frost surface shares, and in Chromium builds
// each surface its own (./maps.ts), so a surface's backdrop-filter becomes
// url(#bje-frost-filter) url(#<its own>) saturate(170%).

'use client'

import { useEffect } from 'react'
import styles from './FrostFilter.module.scss'
import { SHIFT_REM, surfaceMaps } from './maps'

// The id of the shared filter, which each frost surface's refraction names.
export const FROST_FILTER_ID = 'bje-frost-filter'

// Set on <html> where the refraction renders. Until it is set, each frost
// surface keeps its blur, so a page without FrostFilter, or an engine without
// the refraction, still shows frosted glass.
export const REFRACTION_ATTRIBUTE = 'data-frost-refraction'

// brands is optional here: an extension or polyfill can supply userAgentData
// without it, and the blur is then the safe answer.
type UserAgentData = { userAgentData?: { brands?: { brand: string }[] } }

// Whether backdrop-filter renders an SVG filter: in Chromium alone. No CSS
// check can tell, since Firefox and WebKit accept url() there (CSS.supports
// says yes) and draw the backdrop unfiltered. navigator.userAgentData, which
// only Chromium implements, names the engine among its brands. It exists in
// secure contexts (HTTPS, localhost) alone, so elsewhere the blur stays.
export function refracts(navigator: Navigator): boolean {
  const { userAgentData } = navigator as Navigator & UserAgentData
  return userAgentData?.brands?.some(({ brand }) => brand === 'Chromium') ?? false
}

// A class that gives an element of your own (a toolbar, a panel) the frost
// components' treatment, the blur or refraction, edge and translucency, tinted
// from --background.
export const frostSurface = styles.frostSurface

const SVG_NS = 'http://www.w3.org/2000/svg'

// The root font size (1rem), which the bend and the rim light are measured
// in: 16px when the page sets none.
const rem = () => Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16

// RGBA pixels as a data: URL that feImage can show.
function dataUrl(pixels: Uint8ClampedArray, width: number, height: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d') as CanvasRenderingContext2D
  const image = context.createImageData(width, height)
  image.data.set(pixels)
  context.putImageData(image, 0, 0)
  return canvas.toDataURL()
}

function svg(name: string, attributes: Record<string, string | number>): SVGElement {
  const element = document.createElementNS(SVG_NS, name)
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, `${value}`)
  return element
}

// A surface's own filter, w by h px with corner radius r: its displacement
// map bends the rim, then its rim light is screened over the result.
function surfaceFilter(id: string, w: number, h: number, r: number): SVGElement {
  const maps = surfaceMaps(w, h, r, rem())
  const box = { x: 0, y: 0, width: w, height: h, preserveAspectRatio: 'none' }
  const filter = svg('filter', {
    id,
    x: 0,
    y: 0,
    width: w,
    height: h,
    filterUnits: 'userSpaceOnUse',
    'color-interpolation-filters': 'sRGB',
  })
  filter.append(
    svg('feImage', { ...box, href: dataUrl(maps.displacement, w, h), result: 'map' }),
    svg('feDisplacementMap', {
      in: 'SourceGraphic',
      in2: 'map',
      scale: SHIFT_REM * rem() * 2,
      xChannelSelector: 'R',
      yChannelSelector: 'G',
      result: 'bent',
    }),
    svg('feImage', { ...box, href: dataUrl(maps.rim, w, h), result: 'rim' }),
    svg('feBlend', { in: 'rim', in2: 'bent', mode: 'screen' }),
  )
  return filter
}

type Built = { id: string; key: string; filter: SVGElement }

// Builds each frost surface's own filter, and rebuilds it when the surface
// resizes or a popup opens. A frost surface is an element with a data-slot,
// or the frostSurface class, whose computed backdrop-filter names the shared
// filter, as the frost CSS sets it under REFRACTION_ATTRIBUTE. Returns the
// cleanup: observers off, filters gone, and each surface back to its CSS.
export function startSurfaces(): () => void {
  const defs = svg('svg', { 'aria-hidden': 'true', 'data-slot': 'frost-surfaces' })
  defs.setAttribute('class', styles.frostFilter as string)
  document.body.append(defs)
  const built = new Map<HTMLElement, Built>()
  let next = 0

  const build = (element: HTMLElement) => {
    // Layout size, which an opening popup's scale animation leaves alone.
    const w = element.offsetWidth
    const h = element.offsetHeight
    if (w < 4 || h < 4) return
    const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0
    const r = Math.min(radius, w / 2, h / 2)
    const key = `${w}x${h}r${r}`
    let have = built.get(element)
    if (have?.key !== key) {
      const id = have?.id ?? `${FROST_FILTER_ID}-${next++}`
      const filter = surfaceFilter(id, w, h, r)
      have?.filter.remove()
      defs.append(filter)
      have = { id, key, filter }
      built.set(element, have)
    }
    // The shared filter's waves through the whole body first, then this
    // surface's own bend at its rim and its rim light.
    element.style.setProperty(
      'backdrop-filter',
      `url(#${FROST_FILTER_ID}) url(#${have.id}) var(--frost-saturate)`,
    )
  }

  // A surface no longer frost, or gone from the page, takes its filter along,
  // and goes back to its CSS.
  const drop = (element: HTMLElement, { filter }: Built) => {
    filter.remove()
    resize.unobserve(element)
    element.style.removeProperty('backdrop-filter')
    built.delete(element)
  }

  const resize = new ResizeObserver((entries) => {
    for (const entry of entries) build(entry.target as HTMLElement)
  })

  const scan = () => {
    for (const [element, have] of built) if (!element.isConnected) drop(element, have)
    for (const element of document.querySelectorAll<HTMLElement>(
      `[data-slot], .${styles.frostSurface}`,
    )) {
      // The CSS decides, every scan: a variant, a class or a new parent can
      // take the frost away, and the inline filter would hide that.
      const have = built.get(element)
      if (have) element.style.removeProperty('backdrop-filter')
      const filter = getComputedStyle(element).getPropertyValue('backdrop-filter')
      if (!filter.includes(`#${FROST_FILTER_ID}`)) {
        if (have) drop(element, have)
        continue
      }
      if (!have) resize.observe(element)
      build(element)
    }
  }

  // Popups mount, open and close by DOM and attribute changes: one scan per
  // frame, however many arrive.
  let frame: number | undefined
  const mutation = new MutationObserver(() => {
    if (frame !== undefined) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      scan()
    })
  })
  scan()
  mutation.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'data-open', 'data-state'],
  })

  return () => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    mutation.disconnect()
    resize.disconnect()
    for (const element of built.keys()) element.style.removeProperty('backdrop-filter')
    built.clear()
    defs.remove()
  }
}

function FrostFilter() {
  useEffect(() => {
    if (!refracts(window.navigator)) return
    const root = document.documentElement
    root.setAttribute(REFRACTION_ATTRIBUTE, '')
    const stop = startSurfaces()
    return () => {
      stop()
      root.removeAttribute(REFRACTION_ATTRIBUTE)
    }
  }, [])
  // Waves through each surface's whole body: noise, smoothed into swells,
  // bends the backdrop (feDisplacementMap), then a 4px blur frosts it. The
  // blur repeats edge pixels outward, so it pulls nothing transparent in at
  // the rim.
  return (
    <svg
      data-slot="frost-filter"
      aria-hidden="true"
      focusable="false"
      className={styles.frostFilter}
    >
      <filter
        id={FROST_FILTER_ID}
        x="0"
        y="0"
        width="100%"
        height="100%"
        colorInterpolationFilters="sRGB"
      >
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.008 0.012"
          numOctaves={2}
          seed={7}
          result="noise"
        />
        <feGaussianBlur in="noise" stdDeviation={2} result="swells" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="swells"
          scale={16}
          xChannelSelector="R"
          yChannelSelector="G"
          result="refracted"
        />
        <feGaussianBlur in="refracted" stdDeviation={4} edgeMode="duplicate" />
      </filter>
    </svg>
  )
}

export { FrostFilter }
