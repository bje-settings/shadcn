// Renders every case for one theme, each in its own wrapper keyed by
// data-case. `?theme=dark` puts `.dark` on <html>, as shadcn apps do, so
// variables that resolve at the root (Tailwind's --color-*) switch too.
// `?case=<id>` narrows the page to one case; index.html passes both through.

import { cases, type Side } from './cases'

export function Gallery({ side }: { side: Side }) {
  const params = new URLSearchParams(window.location.search)
  const theme = params.get('theme') === 'dark' ? 'dark' : 'light'
  const only = params.get('case')
  document.documentElement.classList.toggle('dark', theme === 'dark')
  return (
    <main
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 8, padding: 16 }}
    >
      {cases
        .filter((c) => c.theme === theme && (only === null || c.id === only))
        .map((c) => (
          <div
            key={c.id}
            data-case={c.id}
            style={{ padding: 12, background: 'var(--background)', color: 'var(--foreground)' }}
          >
            {c.render(side)}
          </div>
        ))}
    </main>
  )
}
