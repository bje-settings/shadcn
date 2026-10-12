// The showcase: shadcn's /create preview blocks, each upstream's own grid of
// cards, rendered with this style's components, CSS modules and global
// stylesheets, loaded as a consumer would. Only the grid's and the cards' own
// layout classes come from the generated utility sheet. As on /create, the
// grid is a fixed-width canvas (2400px; from md 3000px, or 2600px in lyra and
// mira) that scrolls sideways on a narrower screen. The switcher numbers the
// blocks as /create does; `?preview=02` and `?theme=dark` select a block and
// the dark theme, and the controls keep them in the URL.
import '@ab/styles/fonts.css'
import '@ab/styles/variables.scss'
import '@ab/styles/base.scss'
import '@ab/styles/typeset.css'
import '@ab/generated/showcase.css'
import { blocks, style } from '@ab/generated/showcase'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button } from '@/registry/bje/ui/Button/Button'
import { CaseBoundary } from './case-boundary'

type Theme = 'light' | 'dark'

// 01, 02, ...: the switcher's label for the block at `index`.
const label = (index: number) => String(index + 1).padStart(2, '0')

// The header's padding, fluid between the grid's own gaps: --spacing(4) on
// small screens, --spacing(10) from md. It approximates them: the grid's gap
// steps at md rather than scaling, and is --spacing(6) from md in lyra and mira.
const GAP = 'clamp(16px, 3vw, 40px)'

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
      <header
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 12,
          padding: GAP,
          // The grid pads itself by its own gap.
          paddingBottom: 0,
        }}
      >
        <h1 style={{ margin: 0, marginRight: 'auto', fontSize: 16, fontWeight: 600 }}>
          @bje {style}
        </h1>
        <nav aria-label="Preview" style={{ display: 'flex', gap: 4 }}>
          {blocks.map(({ name }, index) => (
            <Button
              key={name}
              size="sm"
              variant={index === shown ? 'default' : 'outline'}
              aria-pressed={index === shown}
              title={name}
              onClick={() => setShown(index)}
            >
              {label(index)}
            </Button>
          ))}
        </nav>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? 'Light' : 'Dark'}
        </Button>
      </header>
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
