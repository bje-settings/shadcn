// Renders every case for one theme, each in its own wrapper keyed by
// data-case. `?theme=dark` puts `.dark` on <html>, as shadcn apps do, so
// variables that resolve at the root (Tailwind's --color-*) switch too.
// `?case=<id>` narrows the page to one case, the only way an overlay case
// renders; index.html passes both through. `window.showCase(id)` switches the
// narrowed case without a reload: the A/B run shows every case that way.
// A case that throws renders its error in place, marked data-case-error, so
// it fails alone rather than blanking the page.

import { Component, type ReactNode, useEffect, useState } from 'react'
import { cases, type Side } from './cases'

class CaseBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  override state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override render() {
    const { error } = this.state
    return error ? <pre data-case-error={error.message}>{error.message}</pre> : this.props.children
  }
}

export function Gallery({ side }: { side: Side }) {
  const params = new URLSearchParams(window.location.search)
  const theme = params.get('theme') === 'dark' ? 'dark' : 'light'
  const [only, setOnly] = useState(params.get('case'))
  useEffect(() => {
    ;(window as Window & { showCase?: (id: string) => void }).showCase = setOnly
  }, [])
  document.documentElement.classList.toggle('dark', theme === 'dark')
  return (
    <main
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 8, padding: 16 }}
    >
      {cases
        // An overlay case renders only on its own page.
        .filter((c) => c.theme === theme && (only === null ? !c.overlay : c.id === only))
        .map((c) => (
          <div
            key={c.id}
            data-case={c.id}
            style={{ padding: 12, background: 'var(--background)', color: 'var(--foreground)' }}
          >
            <CaseBoundary>{c.render(side)}</CaseBoundary>
          </div>
        ))}
    </main>
  )
}
