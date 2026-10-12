// Stand-in for /create's design system search params, which the preview cards
// read their style, fonts and icon library from. Returns the style being built
// and mirror.config.json's theme, which the showcase cannot change.

import { designSystem } from '@ab/generated/showcase-theme'

export function useDesignSystemSearchParams() {
  return [designSystem, () => {}] as const
}
