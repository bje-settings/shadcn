import { describe, expect, it } from 'vitest'
import { fixturesFor, harnessFiles } from './harness.ts'
import { config } from './test-support.ts'
import { transformComponent } from './tsx.ts'

const chip = `import { cva } from "class-variance-authority"
import { cn } from "cn"
const chipVariants = cva("flex", { variants: { tone: { soft: "bg-muted", loud: "bg-primary" } } })
const markVariants = cva("grid")
function Chip({ className, tone }) {
  return <span data-slot="chip" className={cn(chipVariants({ tone }), className)} />
}
function ChipMark({ className }) {
  return <i data-slot="chip-mark" className={markVariants({ className })} />
}
function ChipLabel({ className }) {
  return <span data-slot="chip-label" className={cn("text-sm", className)} />
}
function Internal() {
  return <b data-slot="internal" className="x" />
}
export { Chip, ChipMark, ChipLabel }`

describe('fixturesFor', () => {
  it('adds one fixture per cva option, or one per component without options', () => {
    expect(fixturesFor('chip', transformComponent(chip, 'chip', 'bje'))).toEqual([
      { item: 'chip', component: 'Chip', label: 'Chip tone=soft', props: { tone: 'soft' } },
      { item: 'chip', component: 'Chip', label: 'Chip tone=loud', props: { tone: 'loud' } },
      { item: 'chip', component: 'ChipMark', label: 'ChipMark', props: {} },
      { item: 'chip', component: 'ChipLabel', label: 'ChipLabel', props: {} },
    ])
  })
})

describe('harnessFiles', () => {
  it('writes upstream copies, module maps, fixtures and the Tailwind entry', () => {
    const transformed = transformComponent(chip, 'chip-set', 'bje')
    const files = harnessFiles(
      config,
      [{ name: 'chip-set', upstreamSource: chip, transformed }],
      '// header',
    )
    const byPath = Object.fromEntries(files.map((file) => [file.path, file.content]))
    expect(Object.keys(byPath)).toEqual([
      'ab/generated/upstream/chip-set.tsx',
      'ab/generated/upstream.ts',
      'ab/generated/ours.ts',
      'ab/generated/fixtures.ts',
      'ab/generated/upstream.css',
    ])
    expect(byPath['ab/generated/upstream/chip-set.tsx']).toBe(`// header\n\n${chip}`)
    expect(byPath['ab/generated/upstream.ts']).toContain(
      'import * as chipSet from "./upstream/chip-set"\n\nexport const upstream = {\n  "chip-set": chipSet,\n}',
    )
    expect(byPath['ab/generated/ours.ts']).toContain(
      'import * as chipSet from "@/registry/bje/ui/ChipSet/ChipSet"',
    )
    expect(byPath['ab/generated/fixtures.ts']).toContain('"label": "Chip tone=soft"')
    expect(byPath['ab/generated/upstream.css']).toContain(
      '@import "../../upstream/base-vega/index.css";\n@source "./upstream";',
    )
  })
})
