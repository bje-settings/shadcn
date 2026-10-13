// The style's frost filter, where it ships one (frost, from
// registry/frost/overrides/): the showcase and the A/B page of our side mount
// it once, at their root, as a consumer does, and the showcase's header wears
// its surface.
// Globbed rather than imported, so a style without it resolves no module and
// gets undefined, with no style named here.
import type { ReactNode } from 'react'

type FrostFilterModule = { FrostFilter: () => ReactNode; frostSurface: string }

const modules = import.meta.glob<FrostFilterModule>(
  '@/registry/bje/ui/FrostFilter/FrostFilter.tsx',
  { eager: true },
)

export const frost: FrostFilterModule | undefined = Object.values(modules)[0]
