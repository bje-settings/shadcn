// Every A/B case, all generated: each fixture (exported component and cva()
// option) in light and dark, at rest, hovered, keyboard-focused and disabled;
// each usable sub-example of upstream's docs examples; and each of Typeset's
// content fixtures inside `.typeset`, both in light and dark. Both pages render
// this same list from their own modules and stylesheets.

import type { ReactNode } from 'react'
import { examples } from './generated/examples'
import { fixtures } from './generated/fixtures'
import { typeset } from './generated/typeset'
import { pick, type Ui } from './ui'

// A page's modules: components by item, and example modules by example name.
export type Side = { ui: Ui; examples: Ui }

export type Case = {
  id: string
  theme: 'light' | 'dark'
  state: 'rest' | 'hover' | 'focus' | 'disabled'
  render: (side: Side) => ReactNode
}

const THEMES = ['light', 'dark'] as const
const STATES = ['rest', 'hover', 'focus', 'disabled'] as const

export const cases: Case[] = [
  ...fixtures.flatMap((fixture) =>
    THEMES.flatMap((theme) =>
      STATES.map((state) => ({
        id: `${fixture.label} ${theme} ${state}`,
        theme,
        state,
        render: ({ ui }: Side) => {
          const Component = pick(ui, fixture.item, fixture.component)
          return (
            <Component {...fixture.props} disabled={state === 'disabled' || undefined}>
              {fixture.component}
            </Component>
          )
        },
      })),
    ),
  ),
  ...examples.flatMap((example) =>
    THEMES.map((theme) => ({
      id: `${example.example} ${example.name} ${theme}`,
      theme,
      state: 'rest' as const,
      render: (side: Side) => {
        const Example = pick(side.examples, example.example, example.name)
        return <Example />
      },
    })),
  ),
  ...typeset.flatMap((fixture) =>
    THEMES.map((theme) => ({
      id: `typeset ${fixture.name} ${theme}`,
      theme,
      state: 'rest' as const,
      render: () => (
        <div
          className="typeset"
          style={{ width: 640 }}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: upstream's own Typeset fixture HTML, the content Typeset exists to style
          dangerouslySetInnerHTML={{ __html: fixture.html }}
        />
      ),
    })),
  ),
]
