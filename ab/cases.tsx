// Every A/B case, all generated: each fixture (exported component and cva()
// option) in light and dark, compared at rest, hovered, keyboard-focused and
// disabled; each usable sub-example of upstream's docs examples; and each of
// Typeset's content fixtures inside `.typeset`, both in light and dark. Both
// pages render this same list from their own modules and stylesheets.

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
  // data-slot of the element a state applies to; else the case's first child
  slot?: string
  // Renders only when the page is narrowed to it and is compared as the
  // whole viewport, since its popup portals out of the case
  overlay: boolean
  // Also compared hovered and keyboard-focused, on the same render
  interactive: boolean
  render: (side: Side) => ReactNode
  // The same fixture rendered disabled, compared when its element honours
  // `disabled`
  disabled?: Case
}

const THEMES = ['light', 'dark'] as const

function fixtureCase(
  fixture: (typeof fixtures)[number],
  theme: Case['theme'],
  disabled: boolean,
): Case {
  return {
    id: `${fixture.label} ${theme}${disabled ? ' disabled' : ''}`,
    theme,
    slot: fixture.slot,
    overlay: fixture.overlay,
    interactive: !disabled,
    render: ({ ui }: Side) => {
      const Component = pick(ui, fixture.item, fixture.component)
      let element: ReactNode = (
        <Component {...fixture.props} disabled={disabled || undefined}>
          {fixture.children ? fixture.component : undefined}
        </Component>
      )
      // Inside its scaffold's ancestors, innermost first.
      for (const part of [...fixture.ancestors].reverse()) {
        const Ancestor = pick(ui, fixture.item, part.component)
        const Trigger = part.trigger && pick(ui, fixture.item, part.trigger.component)
        element = (
          <Ancestor {...part.props}>
            {part.trigger && Trigger && (
              <Trigger {...part.trigger.props}>{part.trigger.component}</Trigger>
            )}
            {element}
          </Ancestor>
        )
      }
      return element
    },
  }
}

// One A/B test each.
export const cases: Case[] = [
  ...fixtures.flatMap((fixture) =>
    THEMES.map((theme) => ({
      ...fixtureCase(fixture, theme, false),
      disabled: fixtureCase(fixture, theme, true),
    })),
  ),
  ...examples.flatMap((example) =>
    THEMES.map((theme) => ({
      id: `${example.example} ${example.name} ${theme}`,
      theme,
      overlay: false,
      interactive: false,
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
      overlay: false,
      interactive: false,
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

// Every render the gallery can show: each case and its disabled render.
export const renders: Case[] = cases.flatMap((c) => (c.disabled ? [c, c.disabled] : [c]))
