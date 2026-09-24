// Renders every case, each in its own wrapper keyed by data-case. `?case=<id>`
// narrows the page to one case (the compare page uses it).

import { cases } from './cases'
import type { Ui } from './ui'

export function Gallery({ ui }: { ui: Ui }) {
  const only = new URLSearchParams(window.location.search).get('case')
  return (
    <main
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 8, padding: 16 }}
    >
      {cases
        .filter((c) => only === null || c.id === only)
        .map((c) => (
          <div
            key={c.id}
            data-case={c.id}
            className={c.theme === 'dark' ? 'dark' : undefined}
            style={{ padding: 12, background: 'var(--background)', color: 'var(--foreground)' }}
          >
            {c.render(ui)}
          </div>
        ))}
    </main>
  )
}
