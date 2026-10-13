// The maps of each frost surface's own refraction, after kube.io's liquid
// glass (https://kube.io/blog/liquid-glass-css-svg/): a convex squircle bezel
// bends the backdrop at the surface's rim by Snell's law, the flat middle
// stays clear, and a rim light lies on the edges facing away from the light.
// Pure math, so it runs, and is tested, without a canvas.

// Glass's refractive index; air is 1.
export const IOR = 1.5
// The bezel: how far in from the edge the curve runs, and how tall it is, in px.
export const BEZEL = 36
export const THICKNESS = 60
// The light: the rim light falls on the edges whose outward normal points
// away from this vector, the bottom-right ones.
export const LIGHT = { x: -0.6, y: -0.8 }
// The rim light's peak opacity, and its width in em.
export const SPECULAR = 0.35
export const RIM_EM = 0.25
// The largest shift, at the rim, in rem: the profile sets only how the shift
// fades inward.
export const SHIFT_REM = 1.5

// Convex squircle: a smooth rise from the edge (0) to the flat top (1).
export const height = (t: number): number => (1 - (1 - t) ** 4) ** (1 / 4)

// How far a vertical ray moves sideways, by whole px in from the edge.
export function profile(): number[] {
  const shifts: number[] = []
  for (let i = 0; i <= BEZEL; i++) {
    const t = Math.min(Math.max(i / BEZEL, 0.001), 0.999)
    const d = 0.001
    const slope = ((height(t + d) - height(t - d)) / (2 * d)) * (THICKNESS / BEZEL)
    const incidence = Math.atan(slope)
    const refracted = Math.asin(Math.sin(incidence) / IOR)
    shifts.push(height(t) * THICKNESS * Math.tan(incidence - refracted))
  }
  return shifts
}

const SHIFT = profile()
const MAX = Math.max(...SHIFT, 1)

// The signed distance from a point to a rounded rectangle's edge (negative
// inside), and the edge's outward normal there. The point is relative to
// the box's center; hw and hh are its half width and height, r its radius.
export function edge(px: number, py: number, hw: number, hh: number, r: number) {
  const qx = Math.abs(px) - (hw - r)
  const qy = Math.abs(py) - (hh - r)
  const ox = Math.max(qx, 0)
  const oy = Math.max(qy, 0)
  const outside = Math.hypot(ox, oy)
  const dist = outside + Math.min(Math.max(qx, qy), 0) - r
  let nx = 0
  let ny = 1
  if (outside > 0) {
    nx = ox / outside
    ny = oy / outside
  } else if (qx > qy) {
    nx = 1
    ny = 0
  }
  return { dist, nx: nx * Math.sign(px || 1), ny: ny * Math.sign(py || 1) }
}

// RGBA pixels, row by row, w by h.
export type Maps = {
  // R and G shift x and y, around 128, as feDisplacementMap reads them
  displacement: Uint8ClampedArray
  // White, with the rim light as alpha
  rim: Uint8ClampedArray
}

// A w by h surface's maps, with corner radius r and font size em, in px.
export function surfaceMaps(w: number, h: number, r: number, em: number): Maps {
  // A surface thinner than two bezels gets a bezel that fits it.
  const bezel = Math.max(2, Math.min(BEZEL, Math.min(w, h) / 2 - 1))
  const rim = Math.min(RIM_EM * em, bezel)
  const displacement = new Uint8ClampedArray(w * h * 4)
  const light = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const e = edge(x + 0.5 - w / 2, y + 0.5 - h / 2, w / 2, h / 2, r)
      const inset = -e.dist
      let dx = 0
      let dy = 0
      let lit = 0
      if (inset >= 0 && inset < bezel) {
        // Convex glass magnifies at its rim: each rim pixel shows backdrop
        // from further in, so it samples against the outward normal.
        const m = (SHIFT[Math.floor((inset / bezel) * BEZEL)] as number) / MAX
        dx = -e.nx * m
        dy = -e.ny * m
        // Brightest where the edge faces away from the light, at the rim.
        const facing = Math.max(0, -(e.nx * LIGHT.x + e.ny * LIGHT.y))
        if (inset < rim) lit = facing * (1 - inset / rim) ** 3 * SPECULAR
      }
      displacement[i] = 128 + dx * 127
      displacement[i + 1] = 128 + dy * 127
      displacement[i + 2] = 128
      displacement[i + 3] = 255
      light[i] = 255
      light[i + 1] = 255
      light[i + 2] = 255
      light[i + 3] = Math.round(lit * 255)
    }
  }
  return { displacement, rim: light }
}
