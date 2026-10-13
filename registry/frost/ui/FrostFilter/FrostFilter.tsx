// The frost style's refraction: an SVG filter every frost surface names in
// backdrop-filter. Mount <FrostFilter /> once, at the app's root.

'use client'

import { useEffect } from 'react'
import styles from './FrostFilter.module.scss'

// The id each frost surface's refraction names: url(#bje-frost-filter).
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

// A class that gives an element of your own (a header, a toolbar) the frost
// components' treatment, the blur or refraction, edge and translucency, tinted
// from --background.
export const frostSurface = styles.frostSurface

function FrostFilter() {
  useEffect(() => {
    if (!refracts(window.navigator)) return
    const root = document.documentElement
    root.setAttribute(REFRACTION_ATTRIBUTE, '')
    return () => root.removeAttribute(REFRACTION_ATTRIBUTE)
  }, [])
  // Noise bends the backdrop (feDisplacementMap) the way a lens of uneven
  // frost would; the blurs smooth the noise into swells, then soften the
  // result.
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
          scale={36}
          xChannelSelector="R"
          yChannelSelector="G"
          result="refracted"
        />
        <feGaussianBlur in="refracted" stdDeviation={1.5} />
      </filter>
    </svg>
  )
}

export { FrostFilter }
