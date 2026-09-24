// Compiles upstream class names with Tailwind itself, against the project CSS
// an upstream shadcn project uses (project-css.ts), so the generated SCSS
// carries Tailwind's semantics rather than a hand-written approximation.

import { compile, optimize } from '@tailwindcss/node'

// Where the project CSS's imports (tailwindcss, tw-animate-css,
// shadcn/tailwind.css) resolve from.
const base = import.meta.dirname

// A fresh compiler per call: Tailwind's build() accumulates every candidate it
// has seen, so a shared one would leak one slot's utilities into the next.
// optimize() flattens nesting, leaving one selector per utility under at most
// a chain of @media/@supports wrappers, which scss.ts rebuilds into nesting.
export async function compileCandidates(input: string, candidates: string[]): Promise<string> {
  const compiler = await compile(input, { base, onDependency() {} })
  return optimize(compiler.build(candidates), { minify: false }).code
}
