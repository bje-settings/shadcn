// The style one A/B run renders, from AB_STYLE (a short name: vega, luma), or
// the first in mirror.config.json's upstream.styles. Its generated inputs,
// report and server port are its own, so one style's run never reads or
// overwrites another's.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { forStyle, harnessStyle, parseConfig, shortStyle } from '../scripts/mirror/config.ts'

export const repo = fileURLToPath(new URL('..', import.meta.url))
const mirror = parseConfig(JSON.parse(readFileSync(`${repo}mirror.config.json`, 'utf8')))
const style = harnessStyle(mirror, process.env.AB_STYLE)

// mirror.config.json resolved for the style, as `mirror build` writes it.
export const config = forStyle(mirror, style)
export const short = shortStyle(style)
// A server left running for another style is never reused for this one.
export const port = 4400 + mirror.upstream.styles.indexOf(style)
