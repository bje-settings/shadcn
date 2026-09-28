import { describe, expect, it } from 'vitest'
import { layoutCss, projectCss, staticTheme } from './project-css.ts'

const color = {
  cssVarsV4: {
    light: { background: 'oklch(1 0 0)', radius: '0.625rem' },
    dark: { background: 'oklch(0.145 0 0)' },
  },
}
const font = {
  font: {
    family: "'Inter Variable', sans-serif",
    variable: '--font-sans',
    dependency: '@fontsource-variable/inter',
  },
}

describe('projectCss', () => {
  it('writes what shadcn init writes: imports, theme mapping, variables and base layer', () => {
    const css = projectCss(
      {
        css: {
          '@import "tw-animate-css"': {},
          '@layer base': { body: { '@apply bg-background': {} } },
          '@utility focus-ring': { outline: {} },
        },
      },
      color,
      font,
    )
    expect(css).toContain('@import "tailwindcss";\n@import "tw-animate-css";\n')
    expect(css).toContain('@custom-variant dark (&:is(.dark *));')
    expect(css).toContain("  --font-sans: 'Inter Variable', sans-serif;")
    expect(css).toContain('  --color-background: var(--background);')
    expect(css).not.toContain('--color-radius')
    expect(css).toContain('  --radius-md: calc(var(--radius) * 0.8);')
    expect(css).toContain(':root {\n  --background: oklch(1 0 0);\n  --radius: 0.625rem;\n}')
    expect(css).toContain('.dark {\n  --background: oklch(0.145 0 0);\n}')
    expect(css).toContain('@utility focus-ring {\n  outline {\n  }\n}')
    expect(css).toContain(
      '@layer base {\n  body {\n    @apply bg-background;\n  }\n  html {\n    @apply font-sans;\n  }\n}',
    )
  })

  it('handles a style with no css', () => {
    expect(projectCss({}, color, font)).toContain('@layer base {\n  html {')
  })
})

describe('layoutCss', () => {
  it('compiles only unlayered utilities for the given source, with the same theme setup', () => {
    const css = layoutCss({ css: { '@import "tw-animate-css"': {} } }, color, font, './examples')
    expect(css).toContain('@import "tailwindcss/theme.css" layer(theme);')
    expect(css).toContain('@import "tailwindcss/utilities.css" source(none);')
    expect(css).toContain('@import "tw-animate-css";')
    expect(css).toContain('  --color-background: var(--background);')
    expect(css).not.toContain(':root {')
    expect(css).not.toContain('@layer base')
    expect(css).toContain('@source "./examples";')
    // tailwind-merge's text size over leading, for the examples' own classes
    expect(css).toContain(':not([class*="leading-"]) {\n  --leading: initial;\n}')
  })
})

describe('staticTheme', () => {
  it('imports Tailwind with its whole theme emitted', () => {
    expect(staticTheme('@import "tailwindcss";\n@import "x";')).toBe(
      '@import "tailwindcss" theme(static);\n@import "x";',
    )
  })

  it('refuses project CSS that imports Tailwind otherwise', () => {
    expect(() => staticTheme('@import "tailwindcss" source(none);')).toThrow(
      'project CSS does not import tailwindcss as @import "tailwindcss";',
    )
  })
})
