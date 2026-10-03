import postcss from 'postcss'
import { describe, expect, it } from 'vitest'
import { fontStylesheet, globalStylesheets } from './globals.ts'
import { staticTheme } from './project-css.ts'
import { compileCandidates } from './tailwind.ts'
import { compile, input } from './test-support.ts'

describe('globalStylesheets', () => {
  it('splits variables and base layers out of a full compile and drops utilities', async () => {
    const css = await compile(['bg-primary', 'ring-3', 'text-sm', 'animate-in', 'shimmer'])
    const { variables, base } = globalStylesheets(css, '// header')
    expect(variables.startsWith('// header\n\n@layer properties {')).toBe(true)
    expect(variables).toContain('@layer theme {')
    // shadcn's own registrations stay; Tailwind's internal ones are the modules'.
    expect(variables).toContain('@property --shimmer-angle {')
    for (const sheet of [variables, base]) expect(sheet).not.toContain('--tw-')
    expect(variables).toContain(':root {')
    expect(variables).toContain('.dark {')
    expect(base).toMatch(/^\/\/ header\n\/\*! tailwindcss v[\d.]+ \| MIT License/)
    expect(base).toContain('@layer base {')
    expect(base).toContain('@keyframes enter {')
    expect(base).toContain('opacity: var(--enter-opacity, 1);')
    for (const sheet of [variables, base]) {
      expect(sheet).not.toContain('.bg-primary')
      expect(sheet).not.toContain('.shimmer')
    }
  })

  it('drops a properties fallback left with no declaration', () => {
    const css =
      '@layer properties { @supports (x: y) { *, ::before { --tw-a: 0 } } } @layer theme { :root { --b: 1 } }'
    expect(globalStylesheets(css, '// h').variables).toBe(
      '// h\n\n@layer theme { :root { --b: 1 } }\n',
    )
  })

  it('omits the license line when there is no comment', () => {
    expect(globalStylesheets('@layer base { a { color: red } }', '// h').base).toBe(
      '// h\n\n@layer base { a { color: red } }\n',
    )
  })

  it.each([
    ['a rule', '.stray { color: red }'],
    ['an unknown layer', '@layer other { a { color: red } }'],
    ['a media query holding a non-class rule', '@media print { a { color: red } }'],
    ['a media statement without a block', '@media print;'],
    ['an unknown at-rule', '@font-face { font-family: x }'],
  ])('refuses %s', (_, css) => {
    expect(() => globalStylesheets(css, '')).toThrow('globals: no destination for top-level')
  })
})

describe('fontStylesheet', () => {
  const geist = {
    family: "'Geist Variable', sans-serif",
    variable: '--font-sans',
    dependency: '@fontsource-variable/geist',
  }

  it('imports the font package and sets the variable upstream names to its family', () => {
    expect(fontStylesheet({ font: geist }, '/* h */')).toBe(
      [
        '/* h */',
        '/* Import after variables.scss: this replaces its --font-sans. */',
        '',
        '@import "@fontsource-variable/geist";',
        '',
        '@layer theme {',
        '  :root, :host {',
        "    --font-sans: 'Geist Variable', sans-serif;",
        '  }',
        '}',
        '',
      ].join('\n'),
    )
  })

  // Where a declaration of the variable sits: its enclosing at-rules and rules.
  const placements = (css: string, variable: string) => {
    const found: string[][] = []
    postcss.parse(css).walkDecls(variable, (decl) => {
      const path: string[] = []
      for (let node = decl.parent; node && node.type !== 'root'; node = node.parent) {
        path.unshift(node.type === 'rule' ? node.selector : `@${node.name} ${node.params}`)
      }
      found.push(path)
    })
    return found
  }

  // The same layer and selector as the default's declaration: the cascade
  // then lets whichever stylesheet loads later win.
  it.each(['--font-sans', '--font-heading', '--font-mono', '--font-serif'])(
    'declares %s exactly where variables.scss does',
    async (variable) => {
      // Components read --font-heading, which emits it; the rest are Tailwind's.
      const css = await compileCandidates(staticTheme(input), ['font-heading'])
      const { variables } = globalStylesheets(css, '')
      const font = fontStylesheet({ font: { ...geist, variable } }, '')
      expect(placements(variables, variable)).toEqual([['@layer theme', ':root, :host']])
      expect(placements(font, variable)).toEqual(placements(variables, variable))
    },
  )
})
