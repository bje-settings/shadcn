import { describe, expect, it } from 'vitest'
import type { PartTypes, Scaffold } from './parts.ts'
import { generateTest } from './tests.ts'
import { transformComponent } from './tsx.ts'

const generate = (
  source: string,
  parts: { types: Map<string, PartTypes>; scaffolds: Map<string, Scaffold> } = {
    types: new Map(),
    scaffolds: new Map(),
  },
) => generateTest('chip', transformComponent(source, 'chip', 'bje'), parts)

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
      'expect(classesOfChip()).toEqual(expect.arrayContaining([styles.chip, styles.toneSoft]))',
    )
    expect(test).toContain('    ["extra-loud", styles.toneExtraLoud],')
    expect(test).toContain('const classes = classesOfChip({ tone: null, size: null })')
    expect(test).toContain(
      'for (const className of [styles.toneSoft, styles.toneExtraLoud, styles.sizeSm]) {',
    )
    expect(test).toContain(
      'expect(attributesOfChip({ pressed: false })).toEqual(attributesOfChip())',
    )
    expect(test).toContain('a.value.replace(USE_ID, "")')
    expect(test).toContain('const USE_ID = /_r_[0-9a-z]+_|:r[0-9a-z]+:|«r[0-9a-z]+»/g')
    expect(test).not.toContain('classesOfChip({ tone: "soft" })).toEqual')
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
    expect(test).toContain('closest("[data-slot=\\"chip-label\\"]")')
    expect(test).toContain('expect.arrayContaining([styles.chipLabel])')
    expect(test).toContain(
      'expect(attributesOfChipLabel({ side: "start" })).toEqual(attributesOfChipLabel())',
    )
    expect(test).not.toContain('function attributesOfChip(')
    expect(test).not.toContain('null group')
    expect(test).not.toContain('describe("chipVariants"')
  })

  it('renders each part inside its scaffold and queries the whole document', () => {
    const test = generate(
      `${header}
function Chip({ className }) { return <span data-slot="chip" className={cn("x", className)} /> }
function ChipList({ className }) { return <ul data-slot="chip-list" className={cn("y", className)} /> }
function ChipItem({ className }) { return <li data-slot="chip-item" className={cn("z", className)} /> }
export { Chip, ChipList, ChipItem }`,
      {
        types: new Map(),
        scaffolds: new Map<string, Scaffold>([
          [
            'ChipItem',
            {
              ancestors: [
                { component: 'Chip', props: { defaultOpen: true, value: 'a', count: 2 } },
                { component: 'ChipList', props: {} },
              ],
              props: { value: 'a' },
              children: true,
              others: [
                { ancestors: [], props: { value: 'b' }, children: true },
                { ancestors: [], props: {}, children: false },
              ],
            },
          ],
        ]),
      },
    )
    expect(test).toContain('import { Chip, ChipItem, ChipList } from "./Chip"')
    expect(test).toContain(
      'render(<Chip defaultOpen value="a" count={2}><ChipList><ChipItem data-testid="subject" {...({ "value": "a", "children": "ChipItem", ...props } as ComponentProps<typeof ChipItem>)} /></ChipList></Chip>)',
    )
    expect(test).toContain('  cleanup()\n')
    expect(test).toContain(
      'return document.querySelector(\'[data-testid="subject"]\')?.closest("[data-slot=\\"chip-item\\"]")',
    )
    expect(test).toContain('const element = document.querySelector(".consumer")')
    expect(test).toContain('it("renders as upstream\'s example uses it (2)", () => {')
    expect(test).toContain('render(<ChipItem data-testid="subject" value="b">ChipItem</ChipItem>)')
    expect(test).toContain('render(<ChipItem data-testid="subject" />)')
    expect(test).toContain(
      'expect(document.querySelector("[data-testid=\\"subject\\"]")).not.toBeNull()',
    )
  })

  it('tests a part that renders no element of its own by its children', () => {
    const test = generate(
      `function Chip(props) { return <Primitive.Root data-slot="chip" {...props} /> }
export { Chip }`,
      {
        types: new Map([
          ['Chip', { className: false, opens: true, keepMounted: false, required: [], text: true }],
        ]),
        scaffolds: new Map([
          [
            'Chip',
            {
              ancestors: [],
              props: { value: 'a' },
              children: true,
              others: [{ ancestors: [], props: {}, children: true }],
            },
          ],
        ]),
      },
    )
    expect(test).toContain('import { cleanup, render } from "@testing-library/react"')
    expect(test).not.toContain('ComponentProps')
    expect(test).not.toContain('styles')
    expect(test).toContain('render(<Chip value="a"><i data-testid="child" /></Chip>)')
    expect(test).toContain('it("renders its children", () => {')
    expect(test).toContain('render(<Chip><i data-testid="child" /></Chip>)')
  })

  it('checks what a module re-exports from a package, and nothing else', () => {
    const test = generate(`"use client"
export { Provider, useThing as useIt } from "@base-ui/react/provider"
export type { ProviderProps } from "@base-ui/react/provider"
export { type Other } from "@base-ui/react/other"
export * as all from "@base-ui/react/all"
export { x as "y" } from "@base-ui/react/odd"`)
    expect(test).toContain('import * as provider from "@base-ui/react/provider"')
    expect(test).toContain('import { Provider, useIt } from "./Chip"')
    expect(test).toContain('    expect(Provider).toBe(provider.Provider)')
    expect(test).toContain('    expect(useIt).toBe(provider.useThing)')
    expect(test).not.toContain('Other')
    expect(test).not.toContain('@testing-library/react')
    expect(test).not.toContain('styles')
  })

  it('names the exported components it has no template for', () => {
    expect(() =>
      generate(`${header}
export function Chip({ className }) { return <span data-slot="chip" className={cn("x", className)} /> }
export function ChipIcon() { return null }`),
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
