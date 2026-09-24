import { describe, expect, it } from 'vitest'
import { generateTest } from './tests.ts'
import { transformComponent } from './tsx.ts'

const generate = (source: string) => generateTest('chip', transformComponent(source, 'chip', 'bje'))

const header = `import { cva } from "class-variance-authority"
import { cn } from "cn"`

describe('generateTest', () => {
  it('covers groups, null groups, non-group defaults, className and the variants function', () => {
    const test = generate(`${header}
const chipVariants = cva("flex", {
  variants: { tone: { soft: "bg-muted", "extra-loud": "bg-primary" }, size: { sm: "h-8" } },
  defaultVariants: { tone: "soft" },
})
function Chip({ className, tone = "soft", size, pressed = false, ...props }) {
  return <span data-slot="chip" className={cn(chipVariants({ tone, size }), className)} {...props} />
}
export { Chip, chipVariants }`)
    expect(test).toContain('import { Chip, chipVariants } from "./Chip"')
    expect(test).toContain('it("renders [data-slot=\\"chip\\"] with its classes", () => {')
    expect(test).toContain(
      'expect(renderChip()).toEqual(expect.arrayContaining([styles.chip, styles.toneSoft]))',
    )
    expect(test).toContain('    ["extra-loud", styles.toneExtraLoud],')
    expect(test).toContain('const classes = renderChip({ tone: null, size: null })')
    expect(test).toContain(
      'for (const className of [styles.toneSoft, styles.toneExtraLoud, styles.sizeSm]) {',
    )
    expect(test).toContain(
      'expect(attributesOfChip({ pressed: false })).toEqual(attributesOfChip())',
    )
    expect(test).toContain('.filter((a) => a.name !== "id")')
    expect(test).not.toContain('renderChip({ tone: "soft" })).toEqual')
    expect(test).toContain('expect(chipVariants()).toBe([styles.chip, styles.toneSoft].join(" "))')
  })

  it('tests every exported component, each on its own data-slot', () => {
    const test = generate(`${header}
const chipVariants = cva("flex")
function Chip({ className }) {
  return <span data-slot="chip" className={chipVariants({ className })} />
}
function ChipLabel({ className, side = "start" }) {
  return <span data-slot="chip-label" className={cn("text-sm", className)} />
}
export { Chip, ChipLabel }`)
    expect(test).toContain('import { Chip, ChipLabel } from "./Chip"')
    expect(test).toContain('querySelector("[data-slot=\\"chip-label\\"]")')
    expect(test).toContain('expect.arrayContaining([styles.chipLabel])')
    expect(test).toContain(
      'expect(attributesOfChipLabel({ side: "start" })).toEqual(attributesOfChipLabel())',
    )
    expect(test).not.toContain('function attributesOfChip(')
    expect(test).not.toContain('null group')
    expect(test).not.toContain('describe("chipVariants"')
  })

  it('names the exported components it has no template for', () => {
    expect(() =>
      generate(`${header}
export function Chip({ className }) { return <span data-slot="chip" className={cn("x", className)} /> }
export function ChipIcon() { return <svg /> }`),
    ).toThrow('chip: no test template for ChipIcon yet')
  })

  it('rejects a file with no component it can test', () => {
    expect(() => generate('export const chip = 1')).toThrow(
      "chip: no test template for this component's shape yet",
    )
  })

  it('ignores string-named exports', () => {
    expect(() =>
      generate(`${header}
function Chip() { return <span data-slot="chip" className="x" /> }
export { Chip as "chip" }`),
    ).toThrow("chip: no test template for this component's shape yet")
  })
})
