import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { prepareComponent, type UpstreamItem } from './component.ts'
import { partTypes, scaffolds } from './parts.ts'
import { config, root } from './test-support.ts'
import { transformComponent } from './tsx.ts'

const cssPath = join(root, config.snapshotDir, config.upstream.style, 'index.css')

const dialog: UpstreamItem = {
  name: 'dialog',
  type: 'registry:ui',
  files: [
    {
      path: 'registry/base-vega/ui/dialog.tsx',
      type: 'registry:ui',
      content: `import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { cn } from "cn"
import { Button } from "@/registry/base-vega/ui/button"
function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}
function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn("text-base", className)} {...props} />
}
function DialogClose(props: React.ComponentProps<typeof Button>) {
  return <Button data-slot="dialog-close" {...props} />
}
const helper = 1
export { Dialog, DialogTitle, DialogClose, helper }`,
    },
  ],
}

describe('partTypes', () => {
  it("reads from upstream's types whether each part renders an element and opens", async () => {
    const button: UpstreamItem = {
      name: 'button',
      type: 'registry:ui',
      files: [
        {
          path: 'registry/base-vega/ui/button.tsx',
          type: 'registry:ui',
          content: `import { Button as ButtonPrimitive } from "@base-ui/react/button"
function Button(props: ButtonPrimitive.Props) { return <ButtonPrimitive data-slot="button" {...props} /> }
export { Button }`,
        },
      ],
    }
    const prepared = [
      await prepareComponent(dialog, config, cssPath),
      await prepareComponent(button, config, cssPath),
    ]
    const types = partTypes('base-vega', prepared)
    expect(types.get('dialog')).toEqual(
      new Map([
        ['Dialog', { className: false, opens: true }],
        ['DialogTitle', { className: true, opens: false }],
        ['DialogClose', { className: true, opens: false }],
      ]),
    )
  }, 30_000)
})

describe('scaffolds', () => {
  const chip = transformComponent(
    `import { cva } from "class-variance-authority"
import { cn } from "cn"
const chipVariants = cva("flex", { variants: { tone: { soft: "x" } } })
function Chips({ className }) { return <div data-slot="chips" className={cn("a", className)} /> }
function Chip({ className, tone }) { return <span data-slot="chip" className={cn(chipVariants({ tone }), className)} /> }
function ChipInput({ className }) { return <input data-slot="chip-input" className={cn("b", className)} /> }
function ChipMenu(props) { return <Menu.Root data-slot="chip-menu" {...props} /> }
export { Chips, Chip, ChipInput, ChipMenu }`,
    'chip',
    'bje',
  )
  const types = new Map([
    ['Chips', { className: true, opens: false }],
    ['Chip', { className: true, opens: false }],
    ['ChipInput', { className: true, opens: false }],
    ['ChipMenu', { className: false, opens: true }],
  ])

  it("nests each part as the example first renders it, with the example's literal props", () => {
    const example = `export default function Example() {
  return (
    <ChipMenu open={false} modal label="Menu" count={2} list={["a", 1]} data={{ a: [true] }} skip={value} bad={[x]} odd={{ [k]: 1 }} spread={{ ...o }} className="p-2">
      <div className="flex">
        <Chips aria-label="Chips" style={{ gap: 1 }}>
          {"text"}
          <Chip tone="soft" value="a" disabled>
            Label
          </Chip>
          <Chip value="b" />
        </Chips>
      </div>
      <Other.Thing>
        <ChipInput {...rest} xlink:href="#a" holes={[, 1]} keyed={{ "b-c": 1 }} numeric={{ 1: 2 }} />
      </Other.Thing>
    </ChipMenu>
  )
}`
    const result = scaffolds(example, types, chip)
    const menu = {
      component: 'ChipMenu',
      props: {
        modal: true,
        label: 'Menu',
        count: 2,
        list: ['a', 1],
        data: { a: [true] },
        defaultOpen: true,
      },
    }
    expect(result.get('Chip')).toEqual({
      ancestors: [menu, { component: 'Chips', props: { 'aria-label': 'Chips' } }],
      props: { value: 'a' },
      children: true,
    })
    expect(result.get('ChipInput')).toEqual({
      ancestors: [menu],
      props: { keyed: { 'b-c': 1 } },
      children: false,
    })
    expect(result.get('Chips')?.children).toBe(true)
  })

  it('renders a part the example never uses on its own', () => {
    const withGhost = new Map([...types, ['Ghost', { className: true, opens: false }]])
    const result = scaffolds(undefined, withGhost, chip)
    expect(result.get('Ghost')?.children).toBe(true)
    expect(result.get('Chip')).toEqual({ ancestors: [], props: {}, children: true })
    expect(result.get('ChipInput')).toEqual({ ancestors: [], props: {}, children: false })
    expect(result.get('ChipMenu')).toEqual({ ancestors: [], props: {}, children: true })
  })
})
