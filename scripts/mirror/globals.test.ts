import postcss from 'postcss'
import { describe, expect, it } from 'vitest'
import { fontStylesheet, globalStylesheets } from './globals.ts'
import { staticTheme } from './project-css.ts'
import { UNKNOWN_UNIT_IGNORE } from './stylesheet-lint.ts'
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

describe('the global stylesheets, for Biome', () => {
  const base = (rules: string) => globalStylesheets(`@layer base { ${rules} }`, '// h').base

  it("collapses preflight's repeated declarations to one", () => {
    expect(
      base('a { -webkit-text-decoration: inherit; -webkit-text-decoration: inherit; color: red }'),
    ).toBe('// h\n\n@layer base { a { -webkit-text-decoration: inherit; color: red } }\n')
  })

  it('keeps the later of two values, or an earlier !important one', () => {
    expect(base('a { width: auto; width: 100% }')).toContain('a { width: 100% }')
    expect(base('[hidden] { display: none !important; display: block }')).not.toContain('block')
  })

  it('collapses repeated declarations directly inside an at-rule, and keeps one with no block', () => {
    expect(base('@font-face { font-display: swap; font-display: block }')).toContain(
      '@font-face { font-display: block }',
    )
    expect(base('@media print; a { color: red }')).toContain('@media print; a { color: red }')
  })

  it('collapses repeated declarations in a top-level rule', () => {
    expect(globalStylesheets(':root { --x: 1; --x: 2 }', '// h').variables).toContain(
      ':root { --x: 2 }',
    )
  })

  it('leaves declarations in different blocks alone', () => {
    expect(
      base('a { color: red } b { color: red; & c { color: red } }').split('color'),
    ).toHaveLength(4)
  })

  it('puts one noImportantStyles suppression before each !important declaration', () => {
    const comment =
      "// biome-ignore lint/complexity/noImportantStyles: Tailwind's preflight keeps a hidden element hidden whatever display another rule gives it"
    const one = base('[hidden] {\n    display: none !important;\n  }')
    expect(one).toContain(`{\n    ${comment}\n    display: none !important;`)
    const two = base(
      '[hidden] { display: none !important; d: 3 } [hidden]:x { display: none !important }',
    )
    expect(two.split(comment)).toHaveLength(3)
    expect(two).toContain(`{\n ${comment}\n display: none !important; d: 3 }`)
    expect(two).toContain(`[hidden]:x {\n ${comment}\n display: none !important }`)
  })

  it.each([
    ['another selector', 'a { display: none !important }', 'display in a'],
    ['another attribute', '[data-x] { display: none !important }', 'display in [data-x]'],
    [
      'a rule that only names it',
      'a:not([hidden]) { display: flex !important }',
      'display in a:not([hidden])',
    ],
    ['a descendant of it', '[hidden] a { display: none !important }', 'display in [hidden] a'],
    ['a list beyond it', '[hidden], .x { display: none !important }', 'display in [hidden], .x'],
    ['another property', '[hidden] { color: red !important }', 'color in [hidden]'],
  ])('fails the build naming an !important declaration in %s', (_, rules, what) => {
    expect(() => base(rules)).toThrow(
      `globals: ${what} is !important outside preflight's [hidden] display rule`,
    )
  })

  it('fails the build naming an !important declaration in an at-rule', () => {
    expect(() => base('@font-face { font-display: swap !important }')).toThrow(
      "globals: font-display in @font-face is !important outside preflight's [hidden] display rule",
    )
  })

  // A dropped utility's !important is the module's, with its own suppression.
  it.each([
    ['the utilities layer', '@layer utilities { .x { color: red !important } }'],
    ['a class-only media query', '@media (hover: hover) { .x { color: red !important } }'],
  ])('leaves an !important declaration alone in %s, which is dropped', (_, dropped) => {
    const { variables, base: other } = globalStylesheets(
      `${dropped} @layer base { a { color: red } }`,
      '// h',
    )
    for (const sheet of [variables, other]) expect(sheet).not.toContain('important')
  })

  describe('the noUnknownUnit suppressions', () => {
    const next = `// biome-ignore ${UNKNOWN_UNIT_IGNORE}`
    const start = `// biome-ignore-start ${UNKNOWN_UNIT_IGNORE}`
    const end = `// biome-ignore-end ${UNKNOWN_UNIT_IGNORE}`
    const theme = (decls: string) =>
      globalStylesheets(`@layer theme {\n  :root {\n    ${decls}\n  }\n}`, '// h').variables
    const long = `0 1px ${'1px '.repeat(20)}#0000001a`

    it('go on the line before a one-line declaration Biome misreads, and nowhere else', () => {
      expect(theme('--a: 0 1px #0000;\n    --b: 0 1px #0000001a;\n    --c: 1px')).toBe(
        `// h\n\n@layer theme {\n  :root {\n    --a: 0 1px #0000;\n    ${next}\n    --b: 0 1px #0000001a;\n    --c: 1px\n  }\n}\n`,
      )
    })

    it('go around a declaration the formatter spreads, the last one in its block too', () => {
      expect(theme(`--a: ${long};\n    --b: ${long}`)).toBe(
        `// h\n\n@layer theme {\n  :root {\n    ${start}\n    --a: ${long};\n    ${end}\n    ${start}\n    --b: ${long};\n    ${end}\n  }\n}\n`,
      )
    })

    it('go around a declaration whose value already breaks', () => {
      expect(theme('--a: 0 1px #0000001a,\n    0 2px #0000001a;')).toContain(
        `${start}\n    --a: 0 1px #0000001a,\n    0 2px #0000001a;\n    ${end}\n  }`,
      )
    })

    it('leave alone a property Biome reads right, and a dropped utility', () => {
      const { variables, base: other } = globalStylesheets(
        '/*! license */ @layer utilities { .x { --s: #0000001a } } @layer base { a { color: #0000001a } }',
        '// h',
      )
      expect(variables + other).not.toContain('noUnknownUnit')
      expect(other.split('\n').slice(0, 2)).toEqual(['// h', '/*! license */'])
    })
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
    // postcss reads no // comment.
    postcss.parse(css.replace(/^\s*\/\/.*\n/gm, '')).walkDecls(variable, (decl) => {
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
