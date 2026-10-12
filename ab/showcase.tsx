// The showcase: shadcn's /create preview blocks, each upstream's own grid of
// cards, rendered with this style's components, CSS modules and global
// stylesheets, loaded as a consumer would. Only the grid's and the cards' own
// layout classes come from the generated utility sheet. As on /create, the
// grid is a fixed-width canvas (2400px; from md 3000px, or 2600px in lyra and
// mira) that scrolls sideways on a narrower screen. The switcher numbers the
// blocks as /create does; `?preview=02` and `?theme=dark` select a block and
// the dark theme, and the controls keep them in the URL. The header's heading
// is the bje logo plus the style's name (visually hidden); beside it, a select
// opens another style's page with the same block and theme.
import '@ab/styles/fonts.css'
import '@ab/styles/variables.scss'
import '@ab/styles/base.scss'
import '@ab/styles/typeset.css'
import '@ab/generated/showcase.css'
import { blocks, style } from '@ab/generated/showcase'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CaseBoundary } from './case-boundary'
import { Header, label, type Theme } from './header'

function Showcase() {
  const params = new URLSearchParams(window.location.search)
  const [shown, setShown] = useState(() =>
    Math.max(
      0,
      blocks.findIndex((_, index) => label(index) === params.get('preview')),
    ),
  )
  const [theme, setTheme] = useState<Theme>(params.get('theme') === 'dark' ? 'dark' : 'light')
  useEffect(() => {
    // `.dark` on <html>, as shadcn apps toggle it, so root variables switch too.
    document.documentElement.classList.toggle('dark', theme === 'dark')
    const url = new URL(window.location.href)
    url.searchParams.set('preview', label(shown))
    url.searchParams.set('theme', theme)
    window.history.replaceState(null, '', url)
  }, [shown, theme])
  const block = blocks[shown]
  return (
    <div
      className={`style-${style}`}
      style={{
        minHeight: '100vh',
        background: theme === 'dark' ? 'var(--background)' : 'var(--muted)',
        color: 'var(--foreground)',
      }}
    >
      <Header
        style={style}
        preview={{ blocks, shown, setShown }}
        theme={theme}
        setTheme={setTheme}
      />
      {block && (
        // Each card in the index has its own CaseBoundary (data-card); this
        // one catches the index itself.
        <main key={block.name} data-showcase={block.name}>
          <CaseBoundary>
            <block.Index />
          </CaseBoundary>
        </main>
      )}
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<Showcase />)
