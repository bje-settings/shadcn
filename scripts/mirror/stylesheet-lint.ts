// What the generated stylesheets do about Biome's CSS rules, shared by the
// module printer (scss.ts, component.ts), the global stylesheets (globals.ts)
// and a frost override (overrides.ts).

export type Declaration = { prop: string; important: boolean }

// The items left once each property set more than once in one block keeps
// only the declaration the cascade applies: the last !important one if any,
// else the last. Two utilities merged into one block can set one property
// (noDuplicateProperties); upstream, tailwind-merge keeps the later class, so
// this is what the element gets either way. Items `read` returns undefined
// for (nested blocks) stay where they are.
export function winners<T>(items: readonly T[], read: (item: T) => Declaration | undefined): T[] {
  const decls = items.map(read)
  // The index of the declaration each property keeps
  const kept = new Map<string, number>()
  decls.forEach((decl, i) => {
    if (decl === undefined) return
    const current = kept.get(decl.prop)
    if (current === undefined || decl.important || !decls[current]?.important) {
      kept.set(decl.prop, i)
    }
  })
  return items.filter((_, i) => {
    const decl = decls[i]
    return decl === undefined || kept.get(decl.prop) === i
  })
}

// Biome reads a hex colour whose digits are followed by a letter (#0000001a)
// as a number and a unit, in a custom property's value only. A file-level
// suppression, before any rule, also covers a value the formatter spreads
// over lines, which a next-line one would miss.
export const UNKNOWN_UNIT_IGNORE =
  '// biome-ignore-all lint/correctness/noUnknownUnit: Biome reads a digit-led hex colour in a custom property as a number and a unit (biomejs/biome#12332)'

const CUSTOM_PROPERTY = /(?:^|[{;\s])--[\w-]+\s*:([^;{}]*)/g
const HEX = /#([0-9a-fA-F]+)/g
// The number a CSS tokenizer reads at the start of a hex colour's digits
const NUMBER = /^\d+(?:[eE]\d+)?/

// Whether a stylesheet needs UNKNOWN_UNIT_IGNORE.
export function needsUnknownUnitIgnore(css: string): boolean {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  for (const [, value] of code.matchAll(CUSTOM_PROPERTY)) {
    for (const [, digits] of (value as string).matchAll(HEX)) {
      const number = NUMBER.exec(digits as string)?.[0]
      if (number !== undefined && number.length < (digits as string).length) return true
    }
  }
  return false
}
