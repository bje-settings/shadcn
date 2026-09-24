// Every A/B case: each generated fixture in light and dark, at rest, hovered
// and keyboard-focused, plus the hand-written compositions in both themes.
// Both pages render this same list; only the component modules differ.

import type { ReactNode } from 'react'
import { compositions } from './compositions'
import { fixtures } from './generated/fixtures'
import { pick, type Ui } from './ui'

export type Case = {
  id: string
  theme: 'light' | 'dark'
  state: 'rest' | 'hover' | 'focus'
  render: (ui: Ui) => ReactNode
}

const THEMES = ['light', 'dark'] as const
const STATES = ['rest', 'hover', 'focus'] as const

export const cases: Case[] = [
  ...fixtures.flatMap((fixture) =>
    THEMES.flatMap((theme) =>
      STATES.map((state) => ({
        id: `${fixture.label} ${theme} ${state}`,
        theme,
        state,
        render: (ui: Ui) => {
          const Component = pick(ui, fixture.item, fixture.component)
          return <Component {...fixture.props}>{fixture.component}</Component>
        },
      })),
    ),
  ),
  ...compositions.flatMap((composition) =>
    THEMES.map((theme) => ({
      id: `${composition.name} ${theme}`,
      theme,
      state: 'rest' as const,
      render: composition.render,
    })),
  ),
]
