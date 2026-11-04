import { describe, expect, it } from 'vitest'
import { needsUnknownUnitIgnore, UNKNOWN_UNIT_IGNORE, winners } from './stylesheet-lint.ts'

describe('winners', () => {
  const parse = (decl: string) => {
    const [prop = '', value = ''] = decl.split(': ')
    return { prop, important: value.endsWith('!important') }
  }
  const dedupe = (decls: string[]) => winners(decls, parse)

  it('collapses a same-value repeat to one', () => {
    expect(dedupe(['content: ""', 'color: red', 'content: ""'])).toEqual([
      'color: red',
      'content: ""',
    ])
  })

  it('keeps the later of two values, as the cascade does', () => {
    expect(dedupe(['width: auto', 'width: 100%'])).toEqual(['width: 100%'])
  })

  it('keeps an earlier !important declaration over a later plain one', () => {
    expect(dedupe(['color: red !important', 'color: blue'])).toEqual(['color: red !important'])
  })

  it('keeps a later !important declaration over an earlier plain one', () => {
    expect(dedupe(['color: red', 'color: blue !important'])).toEqual(['color: blue !important'])
  })

  it('keeps the later of two !important declarations', () => {
    expect(dedupe(['color: red !important', 'color: blue !important'])).toEqual([
      'color: blue !important',
    ])
  })

  it('counts a custom property as a property, by its exact name', () => {
    expect(dedupe(['--x: 1', '--X: 2', '--x: 3'])).toEqual(['--X: 2', '--x: 3'])
  })

  it('leaves items that are not declarations where they are', () => {
    expect(
      winners(['a: 1', 'block', 'a: 2', 'b: 1'], (item) =>
        item === 'block' ? undefined : parse(item),
      ),
    ).toEqual(['block', 'a: 2', 'b: 1'])
  })
})

describe('needsUnknownUnitIgnore', () => {
  // Probed on Biome 2.6.4: a digit-led hex colour fires only in a custom
  // property's value, and only where the digits (with an exponent) are
  // followed by a letter, which Biome then reads as a unit.
  it.each([
    ['--x: 0 1px #0000001a;', true],
    ['--x: #0000000d;', true],
    ['--x: #0000001A;', true],
    ['--x: #000c;', true],
    ['--x: #00e;', true],
    ['--x: #0e0a;', true],
    ['--x: #0E0a;', true],
    ['--x: #00a0ff;', true],
    ['--x: var(--r, 0 0 #0000001a);', true],
    ['--x: a#0000001a;', true],
    ['--x:\n    0 1px #0000001a,\n    0 2px #0000;', true],
    ['--x: #0000;', false],
    ['--x: #0003;', false],
    ['--x: #0e0;', false],
    ['--x: #1e5;', false],
    ['--x: #0E0;', false],
    ['--x: #00000026;', false],
    ['--x: #ff0000;', false],
    ['color: #0000001a;', false],
    ['box-shadow: 0 1px #0000001a;', false],
    ['box-shadow: var(--r, 0 0 #0000001a);', false],
  ])('%s needs it: %s', (declaration, expected) => {
    expect(needsUnknownUnitIgnore(`a {\n  ${declaration}\n}\n`)).toBe(expected)
  })

  it('reads a declaration at the start of the text', () => {
    expect(needsUnknownUnitIgnore('--x: #0000001a;')).toBe(true)
  })

  it('reads no comment as a declaration', () => {
    expect(needsUnknownUnitIgnore('// --x: #0000001a;\n/* --y: #0000001a; */\na {}\n')).toBe(false)
  })

  it('names the rule, the reason and the Biome issue', () => {
    expect(UNKNOWN_UNIT_IGNORE).toBe(
      '// biome-ignore-all lint/correctness/noUnknownUnit: Biome reads a digit-led hex colour in a custom property as a number and a unit (biomejs/biome#12332)',
    )
  })
})
