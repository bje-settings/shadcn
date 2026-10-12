// The site's root page: the shared header, with no style current and no
// preview switcher, and a card per style the config builds, each linking to
// the style's showcase. It renders with the A/B style's components and global
// stylesheets; `pnpm build:showcase` builds it with the first style's.
// `?theme=dark` selects the dark theme, and the toggle keeps it in the URL.
import '@ab/styles/fonts.css'
import '@ab/styles/variables.scss'
import '@ab/styles/base.scss'
import '@ab/styles/typeset.css'
import { allStyles } from '@ab/generated/styles'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Card, CardHeader, CardTitle } from '@/registry/bje/ui/Card/Card'
import { pascalCase } from '../scripts/mirror/names.ts'
import { GAP, Header, type Theme } from './header'

function Site() {
  const [theme, setTheme] = useState<Theme>(() =>
    new URLSearchParams(window.location.search).get('theme') === 'dark' ? 'dark' : 'light',
  )
  useEffect(() => {
    // `.dark` on <html>, as shadcn apps toggle it, so root variables switch too.
    document.documentElement.classList.toggle('dark', theme === 'dark')
    const url = new URL(window.location.href)
    url.searchParams.set('theme', theme)
    window.history.replaceState(null, '', url)
  }, [theme])
  return (
    <div
      className={`style-${allStyles[0]}`}
      style={{
        minHeight: '100vh',
        background: theme === 'dark' ? 'var(--background)' : 'var(--muted)',
        color: 'var(--foreground)',
      }}
    >
      <Header theme={theme} setTheme={setTheme} />
      {/* The page's body, apart from the header. */}
      <main
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: GAP,
          padding: GAP,
        }}
      >
        {allStyles.map((name) => (
          // The style's showcase is the directory beside this page.
          <a key={name} href={`./${name}/`} style={{ color: 'inherit', textDecoration: 'none' }}>
            <Card>
              <CardHeader>
                <CardTitle>{pascalCase(name)}</CardTitle>
              </CardHeader>
            </Card>
          </a>
        ))}
      </main>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<Site />)
