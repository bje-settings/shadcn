import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FROST_FILTER_ID,
  FrostFilter,
  frostSurface,
  REFRACTION_ATTRIBUTE,
  refracts,
} from './FrostFilter'
import styles from './FrostFilter.module.scss'

const brands = (...names: string[]) =>
  ({ userAgentData: { brands: names.map((brand) => ({ brand })) } }) as unknown as Navigator

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('FrostFilter', () => {
  it('renders the filter the frost surfaces name, once, hidden', () => {
    render(<FrostFilter />)
    const filters = document.querySelectorAll('filter')
    expect(filters).toHaveLength(1)
    expect(filters[0]?.id).toBe('bje-frost-filter')
    expect(FROST_FILTER_ID).toBe('bje-frost-filter')
    const svg = document.querySelector('svg')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(svg?.getAttribute('class')).toBe(styles.frostFilter)
    expect([...(filters[0]?.children ?? [])].map((primitive) => primitive.tagName)).toEqual([
      'feTurbulence',
      'feGaussianBlur',
      'feDisplacementMap',
      'feGaussianBlur',
    ])
  })

  it('marks the root where the refraction renders, and unmarks it on unmount', () => {
    vi.stubGlobal('navigator', brands('Not A(Brand', 'Chromium'))
    const { unmount } = render(<FrostFilter />)
    expect(document.documentElement.hasAttribute(REFRACTION_ATTRIBUTE)).toBe(true)
    unmount()
    expect(document.documentElement.hasAttribute(REFRACTION_ATTRIBUTE)).toBe(false)
  })

  it('leaves the root unmarked where it does not', () => {
    vi.stubGlobal('navigator', brands('Some Browser'))
    render(<FrostFilter />)
    expect(document.documentElement.hasAttribute(REFRACTION_ATTRIBUTE)).toBe(false)
  })

  it('exports the frost surface class', () => {
    expect(frostSurface).toBe(styles.frostSurface)
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
