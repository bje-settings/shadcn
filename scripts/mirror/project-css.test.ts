import { describe, expect, it } from 'vitest'
import { projectCss } from './project-css.ts'

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
