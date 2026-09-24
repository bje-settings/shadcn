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
function DialogMeter(props: { value: number; tone?: "soft" | "loud"; className?: string; children?: undefined }) {
  return <div data-slot="dialog-meter" {...props} />
}
const helper = 1
export { Dialog, DialogTitle, DialogClose, DialogMeter, helper }`,
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
    const types = partTypes('base-vega', prepared).get('dialog')
    // Every field but the option lists, which hold each DOM attribute union.
    const summary = new Map(
      [...(types ?? [])].map(([name, { options: _, ...rest }]) => [name, rest]),
    )
    const part = { className: true, opens: false, keepMounted: false, required: [], text: true }
    expect(summary).toEqual(
      new Map([
        ['Dialog', { ...part, className: false, opens: true, childrenFunction: false }],
        ['DialogTitle', { ...part, childrenFunction: false }],
        ['DialogClose', { ...part, childrenFunction: false }],
        ['DialogMeter', { ...part, required: ['value'], text: false, childrenFunction: false }],
      ]),
    )
    expect(types?.get('DialogMeter')?.options.tone).toEqual(['soft', 'loud'])
    expect(types?.get('DialogMeter')?.options.value).toBeUndefined()
  }, 30_000)
})

describe('scaffolds', () => {
  const chip = transformComponent(
    `import { cva } from "class-variance-authority"
import { cn } from "cn"
const chipVariants = cva("flex", { variants: { tone: { soft: "x" } } })
function Chips({ className }) { return <div data-slot="chips" className={cn("a", className)} /> }
function Chip({ className, tone, size = "md" }) { return <span data-slot="chip" className={cn(chipVariants({ tone }), className)} /> }
function ChipInput({ className }) { return <input data-slot="chip-input" className={cn("b", className)} /> }
function ChipMenu(props) { return <Menu.Root data-slot="chip-menu" {...props} /> }
function ChipPanel({ className }) { return <div data-slot="chip-panel" className={cn("c", className)} /> }
export { Chips, Chip, ChipInput, ChipMenu, ChipPanel }`,
    'chip',
    'bje',
  )
  const part = {
    className: true,
    opens: false,
    keepMounted: false,
    required: [],
    text: true,
    childrenFunction: false,
    options: {},
  }
  const types = new Map([
    ['Chips', { ...part, text: false, childrenFunction: false, options: {} }],
    ['Chip', part],
    ['ChipInput', part],
    [
      'ChipMenu',
      {
        className: false,
        opens: true,
        keepMounted: false,
        required: [],
        text: true,
        childrenFunction: false,
        options: {},
      },
    ],
    [
      'ChipPanel',
      {
        ...part,
        keepMounted: true,
        required: [],
        text: true,
        childrenFunction: false,
        options: {},
      },
    ],
  ])

  it("nests each part as the example first renders it, with the example's literal props", () => {
    const example = `export default function Example() {
  return (
    <ChipMenu open={false} modal label="Menu" count={2} list={["a", 1]} data={{ a: [true] }} skip={value} bad={[x]} odd={{ [k]: 1 }} spread={{ ...o }} className="p-2">
      <div className="flex">
        <Chips aria-label="Chips" style={{ gap: 1 }}>
          {"text"}
          <Chip tone="soft" size="sm" value="a" disabled>
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
    const result = scaffolds('chip', example, types, chip)
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
    const chips = { component: 'Chips', props: { 'aria-label': 'Chips' } }
    expect(result.get('Chip')).toEqual({
      ancestors: [menu, chips],
      props: { value: 'a' },
      children: true,
      // The second usage, with the variant and default props the first omits
      others: [{ ancestors: [menu, chips], props: { value: 'b' }, children: false }],
    })
    expect(result.get('ChipInput')).toEqual({
      ancestors: [menu],
      props: { keyed: { 'b-c': 1 } },
      children: false,
      others: [],
    })
    // The example passes Chips children, but its type takes no text.
    expect(result.get('Chips')?.children).toBe(false)
  })

  it("follows the example's own components back to where it renders them", () => {
    const example = `function Wrap({ children }) { return <Chips>{children}</Chips> }
function Item() { return <Wrap><Chip value="w" /></Wrap> }
export default function Example() { return <ChipMenu><Item /></ChipMenu> }
export default () => <section><ChipInput /></section>
const [stray] = [<ChipPanel />]`
    const result = scaffolds('other', example, types, chip)
    // ChipMenu comes from where Example renders Item; Chips inside Wrap's own
    // body is not on the JSX path to Chip.
    expect(result.get('Chip')?.ancestors.map((part) => part.component)).toEqual(['ChipMenu'])
    expect(result.get('ChipInput')?.ancestors).toEqual([])
    expect(result.get('ChipPanel')?.ancestors).toEqual([])
  })

  it("renders a part another part renders internally inside that part's context", () => {
    const module = transformComponent(
      `import { cn } from "cn"
function Chips({ className, children }) { return <Root><div data-slot="chips" className={cn("a", className)}>{children}</div><Inner /></Root> }
function Inner() { return <Chip value="x" /> }
function Picker(props) { return <Base components={{ Day: () => <ChipDay /> }} {...props} /> }
function Chip({ className }) { return <span data-slot="chip" className={cn("b", className)} /> }
function ChipDay({ className }) { return <b data-slot="chip-day" className={cn("c", className)} /> }
export { Chips, Chip, Picker, ChipDay }`,
      'chips',
      'bje',
    )
    const withPicker = new Map([
      ['Chips', part],
      ['Chip', part],
      ['Picker', { ...part, text: false }],
      ['ChipDay', part],
    ])
    const example = 'export default function E() { return <><Chips /><Picker /></> }'
    const result = scaffolds('chips', example, withPicker, module)
    // Chips takes children, so Chip renders inside it; Picker does not.
    expect(result.get('Chip')?.ancestors.map((p) => p.component)).toEqual(['Chips'])
    expect(result.get('ChipDay')?.ancestors).toEqual([])
  })

  it('renders a part the example never uses on its own, or inside the item root', () => {
    const withGhost = new Map([...types, ['Ghost', part]])
    const alone = scaffolds('other', undefined, withGhost, chip)
    expect(alone.get('Ghost')?.children).toBe(true)
    expect(alone.get('Chip')).toEqual({ ancestors: [], props: {}, children: true, others: [] })
    expect(alone.get('ChipInput')).toEqual({
      ancestors: [],
      props: {},
      children: false,
      others: [],
    })
    expect(alone.get('ChipPanel')).toEqual({
      ancestors: [],
      props: { keepMounted: true },
      children: true,
      others: [],
    })
    const inRoot = scaffolds('chip-menu', undefined, types, chip)
    expect(inRoot.get('Chip')?.ancestors).toEqual([
      { component: 'ChipMenu', props: { defaultOpen: true } },
    ])
    expect(inRoot.get('ChipMenu')?.ancestors).toEqual([])
  })
})
