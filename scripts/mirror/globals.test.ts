import { describe, expect, it } from 'vitest'
import { globalStylesheets } from './globals.ts'
import { compile } from './test-support.ts'

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
