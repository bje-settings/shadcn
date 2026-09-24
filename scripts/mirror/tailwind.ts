// Compiles upstream class names with Tailwind itself, against the same theme a
// shadcn project uses (tailwind.css beside this file), so the generated SCSS
// carries Tailwind's semantics rather than a hand-written approximation.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compile, optimize } from '@tailwindcss/node'

const base = import.meta.dirname
const input = readFileSync(join(base, 'tailwind.css'), 'utf8')

// A fresh compiler per call: Tailwind's build() accumulates every candidate it
// has seen, so a shared one would leak one slot's utilities into the next.
// optimize() flattens nesting, leaving one selector per utility under at most
// a chain of @media/@supports wrappers, which scss.ts rebuilds into nesting.
export async function compileCandidates(candidates: string[]): Promise<string> {
  const compiler = await compile(input, { base, onDependency() {} })
  return optimize(compiler.build(candidates), { minify: false }).code
}
