// What the generated stylesheets do about Biome's CSS rules, shared by the
// module printer (scss.ts), a module's defaults (component.ts) and the global
// stylesheets (globals.ts).

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
// as a number and a unit, in a custom property's value only (noUnknownUnit,
// biomejs/biome#12332). The suppression sits beside each such declaration: a
// consumer's install drops a file's leading comments, and a file-level one
// with them.
export const UNKNOWN_UNIT_IGNORE =
  'lint/correctness/noUnknownUnit: Biome reads a digit-led hex colour in a custom property as a number and a unit (biomejs/biome#12332)'

const HEX = /#([0-9a-fA-F]+)/g
// The number a CSS tokenizer reads at the start of a hex colour's digits
const NUMBER = /^\d+(?:[eE]\d+)?/

// Whether Biome misreads a declaration's value as a number and a unit.
export function misreadsHex(prop: string, value: string): boolean {
  if (!prop.startsWith('--')) return false
  for (const [, digits] of value.matchAll(HEX)) {
    const number = NUMBER.exec(digits as string)?.[0]
    if (number !== undefined && number.length < (digits as string).length) return true
  }
  return false
}

// biome.json's formatter lineWidth
const LINE_WIDTH = 100

// The comments that go before and after a declaration Biome misreads, given
// the declaration's line as printed, its indentation included and its
// semicolon not. A next-line suppression when the line stays whole; a range
// when it already breaks, or is too long and the formatter spreads it, since
// Biome reports the line the hex colour lands on.
export function unknownUnitSuppression(line: string): { before: string; after?: string } {
  const indent = line.slice(0, line.length - line.trimStart().length)
  if (!line.includes('\n') && line.length + 1 <= LINE_WIDTH) {
    return { before: `${indent}// biome-ignore ${UNKNOWN_UNIT_IGNORE}` }
  }
  return {
    before: `${indent}// biome-ignore-start ${UNKNOWN_UNIT_IGNORE}`,
    after: `${indent}// biome-ignore-end ${UNKNOWN_UNIT_IGNORE}`,
  }
}
