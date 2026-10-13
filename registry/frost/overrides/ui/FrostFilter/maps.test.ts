import { describe, expect, it } from 'vitest'
import {
  BEZEL,
  edge,
  height,
  IOR,
  LIGHT,
  profile,
  RIM_REM,
  SHIFT_REM,
  SPECULAR,
  surfaceMaps,
  THICKNESS,
} from './maps'

// One pixel's channels in a w-wide RGBA map.
const pixel = (map: Uint8ClampedArray, w: number, x: number, y: number) => [
  ...map.slice((y * w + x) * 4, (y * w + x) * 4 + 4),
]

describe('the constants', () => {
  it('are the approved design', () => {
    expect({ BEZEL, THICKNESS, IOR, SPECULAR, RIM_REM, SHIFT_REM, LIGHT }).toEqual({
      BEZEL: 36,
      THICKNESS: 60,
      RIM_REM: 0.25,
      IOR: 1.5,
      SPECULAR: 0.35,
      SHIFT_REM: 1.5,
      LIGHT: { x: -0.6, y: -0.8 },
    })
  })
})

describe('height', () => {
  it('rises from the edge to the flat top', () => {
    expect(height(0)).toBe(0)
    expect(height(1)).toBe(1)
    expect(height(0.5)).toBeGreaterThan(0.5)
  })
})

describe('profile', () => {
  it('shifts most near the rim and nothing on the flat top', () => {
    const shifts = profile()
    expect(shifts).toHaveLength(BEZEL + 1)
    const peak = Math.max(...shifts)
    expect(peak).toBeGreaterThan(1)
    expect(shifts.indexOf(peak)).toBeLessThan(BEZEL / 2)
    expect(shifts.at(-1)).toBeCloseTo(0, 0)
  })
})

describe('edge', () => {
  it('measures inside a side, on its axis', () => {
    expect(edge(8, 0, 10, 10, 2)).toEqual({ dist: -2, nx: 1, ny: 0 })
    expect(edge(0, -8, 10, 10, 2)).toEqual({ dist: -2, nx: 0, ny: -1 })
  })

  it('takes a point on the center line as on the positive side', () => {
    expect(edge(0, 0, 10, 6, 2)).toEqual({ dist: -6, nx: 0, ny: 1 })
  })

  it('points out through a rounded corner', () => {
    const { dist, nx, ny } = edge(-10, 10, 10, 10, 4)
    expect(dist).toBeCloseTo(Math.hypot(4, 4) - 4)
    expect(nx).toBeCloseTo(-Math.SQRT1_2)
    expect(ny).toBeCloseTo(Math.SQRT1_2)
  })
})

describe('surfaceMaps', () => {
  const w = 101
  const h = 81
  const { displacement, rim } = surfaceMaps(w, h, 12, 16)

  it('leaves the flat middle unbent and unlit', () => {
    expect(pixel(displacement, w, 50, 40)).toEqual([128, 128, 128, 255])
    expect(pixel(rim, w, 50, 40)).toEqual([255, 255, 255, 0])
  })

  it('samples each rim pixel from further in', () => {
    const [leftX] = pixel(displacement, w, 1, 40)
    const [rightX] = pixel(displacement, w, w - 2, 40)
    const [, topY] = pixel(displacement, w, 50, 1)
    const [, bottomY] = pixel(displacement, w, 50, h - 2)
    expect(leftX).toBeGreaterThan(128)
    expect(rightX).toBeLessThan(128)
    expect(topY).toBeGreaterThan(128)
    expect(bottomY).toBeLessThan(128)
  })

  it('lights the bottom-right rim alone', () => {
    const alpha = (x: number, y: number) => pixel(rim, w, x, y)[3] as number
    expect(alpha(50, h - 1)).toBeGreaterThan(0)
    expect(alpha(w - 1, 40)).toBeGreaterThan(0)
    expect(alpha(50, 0)).toBe(0)
    expect(alpha(0, 40)).toBe(0)
    // Past the rim light's width (0.25rem), still in the bezel.
    expect(alpha(50, h - 10)).toBe(0)
  })

  it('leaves the pixels outside a rounded corner alone', () => {
    expect(pixel(displacement, w, 0, 0)).toEqual([128, 128, 128, 255])
    expect(pixel(rim, w, w - 1, h - 1)).toEqual([255, 255, 255, 0])
  })

  it('fits the bezel to a thin surface', () => {
    const thin = surfaceMaps(6, 6, 0, 16)
    expect(pixel(thin.displacement, 6, 0, 3)[0]).toBeGreaterThan(128)
    expect(pixel(thin.displacement, 6, 2, 3)).toEqual([128, 128, 128, 255])
  })
})
