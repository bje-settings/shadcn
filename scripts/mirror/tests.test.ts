import { describe, expect, it } from 'vitest'
import { generateTest } from './tests.ts'
import { transformComponent } from './tsx.ts'

const generate = (source: string) => generateTest('chip', transformComponent(source, 'chip'))

const chip = (exports: string, config = '') => `import { cva } from "class-variance-authority"
import { cn } from "cn"
const chipVariants = cva("flex"${config})
${exports.startsWith('export function') ? exports : 'function Chip({ className }) {'}
  return <span data-slot="chip" className={chipVariants({ className })} />
}
${exports.startsWith('export function') ? '' : exports}`

describe('generateTest', () => {
  it('covers each group option, null groups, className and the no-argument call', () => {
    const test = generate(
      chip(
        'export { Chip, chipVariants }',
        ', { variants: { tone: { soft: "bg-muted", "extra-loud": "bg-primary" }, size: { sm: "h-8" } }, defaultVariants: { tone: "soft" } }',
      ),
    )
    expect(test).toContain('import { Chip, chipVariants } from "./Chip"')
    expect(test).toContain('it("renders [data-slot=\\"chip\\"] with the base and default classes"')
    expect(test).toContain('expect(renderChip()).toEqual([styles.chip, styles.toneSoft])')
    expect(test).toContain('    ["extra-loud", styles.toneExtraLoud],')
    expect(test).toContain('expect(renderChip({ tone: null, size: null })).toEqual([styles.chip])')
    expect(test).toContain('expect(chipVariants()).toBe([styles.chip, styles.toneSoft].join(" "))')
  })

  it('skips group and variants-function tests when there are none to cover', () => {
    const test = generate(chip('export function Chip({ className }) {'))
    expect(test).toContain('import { Chip } from "./Chip"')
    expect(test).not.toContain('null group')
    expect(test).not.toContain('describe("chipVariants"')
  })

  it.each([
    ['no cva() rendered by the component', 'export function Chip() { return <span /> }'],
    ['an unexported component', chip('export { chipVariants }')],
    ['a component exported under a string name', chip('export { Chip as "chip" }')],
    [
      'a cva() used outside a named function',
      'import { cva } from "class-variance-authority"\nconst chipVariants = cva("x")\nexport default () => <i data-slot="chip" className={chipVariants()} />',
    ],
    [
      'a cva() on an element without a string data-slot',
      'import { cva } from "class-variance-authority"\nconst chipVariants = cva("x")\nexport function Chip() { return <i className={chipVariants()} /> }',
    ],
  ])('rejects %s', (_, source) => {
    expect(() => generate(source)).toThrow('chip: no test template')
  })
})
