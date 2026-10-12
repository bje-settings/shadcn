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
import { allStyles } from '@ab/generated/styles'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button } from '@/registry/bje/ui/Button/Button'
import { NativeSelect, NativeSelectOption } from '@/registry/bje/ui/NativeSelect/NativeSelect'
import { CaseBoundary } from './case-boundary'

type Theme = 'light' | 'dark'

// 01, 02, ...: the switcher's label for the block at `index`.
const label = (index: number) => String(index + 1).padStart(2, '0')

// The header's padding, fluid between the grid's own gaps: --spacing(4) on
// small screens, --spacing(10) from md. It approximates them: the grid's gap
// steps at md rather than scaling, and is --spacing(6) from md in lyra and mira.
// Upstream's 3xl step (--spacing(12)) does not apply here: the theme defines no
// 3xl breakpoint.
const GAP = 'clamp(16px, 3vw, 40px)'

// The bje mark (bje-co/bje.co, src/components/Logo.tsx), inline so the page
// requests nothing for it, filled with the style's primary color.
const LOGO =
  'M54.56 206.49c0-3.84 2.26-6.1 6.1-6.1H83q6.1 0 6.1 6.1v45.4a51.33 51.33 0 0128.9-8.59c29.59 0 54.88 23.49 54.88 58.72 0 35.69-26.42 58.72-54.88 58.72-16.49 0-26.88-6.1-34.78-12.87l-10.67 6.37a199.38 199.38 0 0077.67 39.6 5 5 0 01-.14-1c0-1.13.45-2.49 1.81-4.74l7.68-11.52c1.35-2 3.16-3.16 5-3.16a9.46 9.46 0 013.39.9 29.79 29.79 0 009.71 1.81c6.55 0 11.07-5.19 11.07-13.1V269.5l-8.13-13.78c-1.35-2-2.48-4.07-2.48-5.87 0-2.48 2-4.29 5.87-4.29h33.88a5.69 5.69 0 016.1 6.1v114.51c0 17.42-7.2 27.93-16.66 33.74a199 199 0 00116.11-42.51 85.49 85.49 0 01-24.25 3.35c-39.3 0-60.3-24.62-60.3-58.72 0-31.84 19.2-58.72 57.82-58.72 37 0 57.6 27.33 57.6 58.72v6.32c0 3.84-2.94 6.1-6.78 6.1h-74.76c.9 10.84 11.29 20.1 28.46 20.1a45.39 45.39 0 0024.17-6.78c3.38-2 6.32-1.81 8.58 1.35l8.67 11.11A199.32 199.32 0 00400 200.09c0-110.46-89.54-200-200-200S0 89.64 0 200.09A199.25 199.25 0 0054.56 337.3V206.49zm134.18 0c0-3.84 2.26-6.1 6.1-6.1h23c3.84 0 6.1 2.26 6.1 6.1v19.2c0 3.84-2.26 6.1-6.1 6.1h-23c-3.84 0-6.1-2.26-6.1-6.1v-19.2zm-77.49 125.12c-9 0-16.72-5.19-22.13-11.52V281.7c6.32-6.1 14.88-9.7 22.13-9.7 14.68 0 26.42 10.62 26.42 30 0 19-11.97 29.61-26.42 29.61zm209.17-40h-47.66c.23-9.26 7.9-21.46 23.94-21.46 16.3.03 23.49 12.23 23.72 21.49z'

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
        {/* The heading and the select are the left group; its margin pushes the preview switcher right. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 'auto' }}>
          <h1
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              margin: 0,
              fontSize: 16,
              fontWeight: 600,
            }}
          >
            <svg
              role="img"
              aria-label="bje"
              viewBox="0 0 400 400"
              width={42}
              height={42}
              style={{ flex: 'none' }}
            >
              <path fill="var(--primary)" d={LOGO} />
            </svg>
            {/* The select shows the style, so the name is hidden from sight but names the heading. */}
            <span
              style={{
                position: 'absolute',
                width: 1,
                height: 1,
                overflow: 'hidden',
                clip: 'rect(0, 0, 0, 0)',
                whiteSpace: 'nowrap',
                margin: -1,
                border: 0,
                padding: 0,
              }}
            >
              {style}
            </span>
          </h1>
          <NativeSelect
            aria-label="Style"
            size="sm"
            value={style}
            onChange={(event) => {
              // On the site each style's page is `<short>/`, a sibling of this one (the
              // trailing slash makes `../` resolve to it).
              const next = new URL(`../${event.target.value}/`, window.location.href)
              next.searchParams.set('preview', label(shown))
              next.searchParams.set('theme', theme)
              window.location.assign(next)
            }}
          >
            {allStyles.map((name) => (
              <NativeSelectOption key={name} value={name}>
                {name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
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
