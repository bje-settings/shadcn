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
  // data-slot of the element a state applies to; else the case's first child
  slot?: string
  // Renders alone on its page and is compared as the whole viewport, since
  // its popup portals out of the case
  overlay: boolean
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
        slot: fixture.slot,
        overlay: fixture.overlay,
        render: ({ ui }: Side) => {
          const Component = pick(ui, fixture.item, fixture.component)
          let element: ReactNode = (
            <Component {...fixture.props} disabled={state === 'disabled' || undefined}>
              {fixture.children ? fixture.component : undefined}
            </Component>
          )
          // Inside its scaffold's ancestors, innermost first.
          for (const part of [...fixture.ancestors].reverse()) {
            const Ancestor = pick(ui, fixture.item, part.component)
            element = <Ancestor {...part.props}>{element}</Ancestor>
          }
          return element
        },
      })),
    ),
  ),
  ...examples.flatMap((example) =>
    THEMES.map((theme) => ({
      id: `${example.example} ${example.name} ${theme}`,
      theme,
      state: 'rest' as const,
      overlay: false,
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
      overlay: false,
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
