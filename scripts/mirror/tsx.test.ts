import { describe, expect, it } from 'vitest'
import { transformComponent } from './tsx.ts'

const button = `import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// Upstream comment
const buttonVariants = cva("inline-flex h-9", {
  variants: {
    variant: { default: "bg-primary", outline: "border" },
    size: { default: "h-9", "icon-xs": "size-6" },
  },
  defaultVariants: { variant: "default", size: "default" },
})

function Button({ className, variant = "default", size = "default", ...props }: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return <ButtonPrimitive data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }`

describe('transformComponent', () => {
  it('replaces cva with a lookup object and a cva-compatible function', () => {
    const { code, slots } = transformComponent(button, 'button', 'bje')
    expect(slots).toEqual([
      { name: 'button', classes: ['inline-flex', 'h-9'] },
      { name: 'variantDefault', classes: ['bg-primary'] },
      { name: 'variantOutline', classes: ['border'] },
      { name: 'sizeDefault', classes: ['h-9'] },
      { name: 'sizeIconXs', classes: ['size-6'] },
    ])
    expect(code).not.toContain('class-variance-authority')
    expect(code).toContain(
      'import { type ClassValue, clsx } from "clsx"\nimport styles from "./Button.module.scss"\n',
    )
    expect(code).toContain('    "icon-xs": styles.sizeIconXs,')
    expect(code).toContain('  variant = "default",')
    expect(code).toContain('}: ButtonVariantProps & { className?: ClassValue } = {}) {')
    expect(code).toContain('ButtonPrimitive.Props & ButtonVariantProps')
    expect(code).toContain('className={buttonVariants({ variant, size, className })}')
    expect(code).toContain('// Upstream comment')
  })

  it('prefixes a secondary cva, handles no config or defaults, and adds the clsx import', () => {
    const source = `import * as React from "react"
import { cva } from "class-variance-authority"
const button = cva("flex")
const toggleVariants = cva("grid", { variants: { size: { sm: "h-8" } } })
export { button, toggleVariants }`
    const { code, slots } = transformComponent(source, 'button', 'bje')
    expect(slots.map((slot) => slot.name)).toEqual(['button', 'toggle', 'toggleSizeSm'])
    expect(code).toContain('import * as React from "react"\nimport { type ClassValue, clsx }')
    expect(code).toContain('function toggleVariants({\n  size,\n  className,')
    expect(code).toContain('function button({\n  className,')
  })

  it('moves className strings and cn() strings to the element data-slot', () => {
    const source = `import { cn } from "cn"
function Card({ className, extra }) {
  return (
    <div data-slot="card" className={cn("flex gap-2", className, "p-4")}>
      <div id="x" data-slot="card-title" className="font-medium" />
      <div data-slot="card-title" className="font-medium" />
      <div data-slot="card-footer" className={cn(extra.value, className)} />
      <div className={className} />
      <div className />
    </div>
  )
}`
    const { code, slots } = transformComponent(source, 'card', 'bje')
    expect(slots).toEqual([
      { name: 'card', classes: ['flex', 'gap-2', 'p-4'] },
      { name: 'cardTitle', classes: ['font-medium'] },
    ])
    expect(code).toContain('className={clsx(styles.card, className)}')
    expect(code).toContain('data-slot="card-title" className={styles.cardTitle}')
    expect(code).toContain('className={clsx(extra.value, className)}')
    expect(code).not.toContain('from "cn"')
  })

  it('removes a cva import on the first line', () => {
    const source =
      'import { cva } from "class-variance-authority"\nconst a = <i data-slot="a" className="x" />'
    expect(transformComponent(source, 'x', 'bje').code).toBe(
      '\nimport styles from "./X.module.scss"\nconst a = <i data-slot="a" className={styles.a} />',
    )
  })

  it('adds no module import for a component without classes', () => {
    const source = '"use client"\nexport { Provider } from "@base-ui/react/provider"'
    expect(transformComponent(source, 'x', 'bje')).toMatchObject({ code: source, slots: [] })
  })

  it.each([
    ['cva in a multi-variable declaration', 'const a = cva("x"), b = 1'],
    ['cva with no base', 'const aVariants = cva()'],
    ['an exported cva', 'export const aVariants = cva("x")'],
    ['a cva inside a function', 'function f() { return cva("x") }'],
    [
      'a variant group that is not an identifier',
      'const aVariants = cva("x", { variants: { "data-size": { sm: "h-8" } } })',
    ],
    [
      'a default that is not an option',
      'const aVariants = cva("x", { variants: { size: { sm: "h-8" } }, defaultVariants: { size: "lg" } })',
    ],
    [
      'a default for no variant group',
      'const aVariants = cva("x", { defaultVariants: { size: "sm" } })',
    ],
    [
      'a class string constant passed to cn()',
      'const base = "flex"\nconst c = <div data-slot="a" className={cn(base, className)} />',
    ],
    [
      'a class string constant as className',
      'const base = `flex`\nconst c = <div data-slot="a" className={base} />',
    ],
    [
      'class strings passed through another function in cn()',
      'const c = <div data-slot="a" className={cn(twMerge("flex"), className)} />',
    ],
    [
      'class strings passed through another function as className',
      'const c = <div data-slot="a" className={clsx("flex")} />',
    ],
    ['cva with extra arguments', 'const aVariants = cva("x", {}, {})'],
    ['a non-string cva base', 'const aVariants = cva(["x"])'],
    ['a non-object cva config', 'const aVariants = cva("x", config)'],
    ['cva compoundVariants', 'const aVariants = cva("x", { compoundVariants: [] })'],
    ['a spread in a cva config', 'const aVariants = cva("x", { ...base })'],
    ['a computed cva key', 'const aVariants = cva("x", { [key]: {} })'],
    ['a numeric cva key', 'const aVariants = cva("x", { variants: { size: { 1: "h-1" } } })'],
    [
      'a non-string default variant',
      'const aVariants = cva("x", { defaultVariants: { size: size } })',
    ],
    ['cn imported with other names', 'import { cn, other } from "cn"'],
    ['VariantProps without a typeof', 'type P = VariantProps<Other>'],
    ['VariantProps of a member', 'type P = VariantProps<typeof a.b>'],
    ['a conditional cn() argument outside JSX', 'const c = cn(a ? "x" : "y")'],
    ['a className string on a namespaced tag', 'const c = <svg:rect className="x" />'],
    ['a className string in a destructuring declaration', 'const [c] = [<i className="x" />]'],
    [
      'a template branch in a conditional cn() argument',
      'const c = <i data-slot="a" className={cn(a ? `x` : "y")} />',
    ],
    [
      'a class condition it cannot name',
      'const c = <i data-slot="a" className={cn(f() ? "x" : "y")} />',
    ],
    ['cn() && without a string', 'const c = <i data-slot="a" className={cn(a && b)} />'],
    ['cn() strings in an unnamed default export', 'export default () => <i className={cn("x")} />'],
    ['cn() strings outside JSX', 'const c = cn("x")'],
    ['a template className', 'const c = <div className={`x`} />'],
  ])('rejects %s', (_, source) => {
    expect(() => transformComponent(source, 'a', 'bje')).toThrow(/^Unsupported at \d+:\d+: /)
  })
})

describe('import placement', () => {
  it('adds imports after a leading directive when there are no imports', () => {
    const { code } = transformComponent(
      '"use client"\nconst c = <i data-slot="a" className="x" />',
      'a',
      'bje',
    )
    expect(code).toBe(
      '"use client"\nimport styles from "./A.module.scss"\nconst c = <i data-slot="a" className={styles.a} />',
    )
  })

  it('allows calls without class strings, and constants that are not strings', () => {
    const source = 'const size = 4\nconst c = <i data-slot="a" className={cn(pick(size), size)} />'
    expect(() => transformComponent(source, 'a', 'bje')).not.toThrow()
  })
})

describe('cross-component imports', () => {
  it('points registry imports at this registry and reports them', () => {
    const source = `import { Separator } from "@/registry/base-vega/ui/separator"
import { Other } from "@/lib/other"`
    const { code, registryImports } = transformComponent(source, 'x', 'bje')
    expect(code).toContain('import { Separator } from "@/registry/bje/ui/Separator/Separator"')
    expect(code).toContain('import { Other } from "@/lib/other"')
    expect(registryImports).toEqual(['separator'])
  })
})

describe('useRender slots', () => {
  const render = (options: string) => `import { cn } from "cn"
function Text({ className }) {
  return useRender({ ${options} props: { className: cn("flex", className) } })
}`

  it('reads the slot from useRender state', () => {
    const { slots, components } = transformComponent(
      render('state: { slot: "text-slot" },'),
      'x',
      'bje',
    )
    expect(slots).toEqual([{ name: 'textSlot', classes: ['flex'] }])
    expect(components).toEqual([
      { name: 'Text', dataSlot: 'text-slot', slot: 'textSlot', defaults: [] },
    ])
  })

  it.each([
    ['no state', ''],
    ['a state without a slot', 'state: { open: true },'],
  ])('rejects class strings with %s', (_, options) => {
    expect(() => transformComponent(render(options), 'x', 'bje')).toThrow(
      'outside an element with data-slot',
    )
  })

  it('rejects useRender options that are not an object literal', () => {
    const source = 'import { cn } from "cn"\nconst a = useRender(cn("flex"))'
    expect(() => transformComponent(source, 'x', 'bje')).toThrow('expected an object literal')
  })

  it('rejects a non-string slot', () => {
    expect(() => transformComponent(render('state: { slot: name },'), 'x', 'bje')).toThrow(
      'expected a string literal',
    )
  })
})

describe('component tracking', () => {
  it('records each top-level function or arrow component, its element and literal defaults', () => {
    const source = `import { cn } from "cn"
import { cva } from "class-variance-authority"
const xVariants = cva("grid")
function Card({ className, size = "sm", count = 2, open = false, label = name, "aria-x": ax = 1, ...props }) {
  return (
    <div data-slot="card" className={cn(xVariants(), className, helper())}>
      <div data-slot="card-title" className="font-medium" />
    </div>
  )
}
function Plain(props) { return <i data-slot="plain" className="p-1" /> }
function Empty() { return <i data-slot="empty" className="p-2" /> }
const Arrow = () => <i data-slot="arrow" className="p-3" />
export default function () { return <i data-slot="anon" className="p-4" /> }`
    const { components } = transformComponent(source, 'x', 'bje')
    expect(components).toEqual([
      {
        name: 'Card',
        dataSlot: 'card',
        tag: 'div',
        variantSet: 'xVariants',
        defaults: [
          { prop: 'size', value: '"sm"' },
          { prop: 'count', value: '2' },
          { prop: 'open', value: 'false' },
        ],
      },
      { name: 'Plain', dataSlot: 'plain', tag: 'i', slot: 'plain', defaults: [] },
      { name: 'Empty', dataSlot: 'empty', tag: 'i', slot: 'empty', defaults: [] },
      { name: 'Arrow', dataSlot: 'arrow', tag: 'i', slot: 'arrow', defaults: [] },
    ])
  })
})

describe('slot names', () => {
  const transform = (body: string) =>
    transformComponent(`import { cn } from "cn"\n${body}`, 'a', 'bje')

  it('names elements without a data-slot from their owner and tag', () => {
    const { code, slots } = transform(`function AccordionTrigger() {
  return <Primitive.Header className="flex"><span className={cn("sr-only")} /></Primitive.Header>
}
export const Arrow = () => <svg className="size-4" />`)
    expect(slots.map((slot) => slot.name)).toEqual([
      'accordionTriggerHeader',
      'accordionTriggerSpan',
      'arrowSvg',
    ])
    expect(code).toContain('<Primitive.Header className={styles.accordionTriggerHeader}>')
  })

  it('gives each branch of a conditional class its own slot', () => {
    const { code, slots } = transform(`function C({ orientation, open, inset }) {
  return <div data-slot="c" className={cn("flex", orientation === "horizontal" ? "-ml-4" : "flex-col", open ? props.x : "", inset && "pl-8", props.y ? "a" : "b")} />
}`)
    expect(slots).toEqual([
      { name: 'cHorizontal', classes: ['-ml-4'] },
      { name: 'cNotHorizontal', classes: ['flex-col'] },
      { name: 'cInset', classes: ['pl-8'] },
      { name: 'cY', classes: ['a'] },
      { name: 'cNotY', classes: ['b'] },
      { name: 'c', classes: ['flex'] },
    ])
    expect(code).toContain(
      'clsx(styles.c, orientation === "horizontal" ? styles.cHorizontal : styles.cNotHorizontal, open ? props.x : null, inset && styles.cInset, props.y ? styles.cY : styles.cNotY)',
    )
  })

  it('suffixes classes passed in a fooClassName prop', () => {
    const { slots } = transform(
      'const O = () => <Otp data-slot="otp" containerClassName={cn("flex")} className={cn("block")} />',
    )
    expect(slots.map((slot) => slot.name)).toEqual(['otpContainer', 'otp'])
  })

  it('keeps apart one data-slot with different classes: owner name, then a number', () => {
    const { slots } =
      transform(`function FieldLabel() { return <i data-slot="field-label" className="a" /> }
function FieldTitle() { return <i data-slot="field-label" className="b" /> }
function Again() { return <><i data-slot="field-label" className="a" /><i data-slot="field-label" className="c" /><i data-slot="field-label" className="d" /></> }`)
    expect(slots.map((slot) => slot.name)).toEqual([
      'fieldLabel',
      'fieldTitle',
      'again',
      'fieldLabel2',
    ])
  })

  it('names keyed parts from the owner and key, and clsx objects from their conditions', () => {
    const { code, slots, components } = transform(`function Cal({ className, mode, open }) {
  return <Picker data-slot="cal" className={cn(String.raw\`[&_.x\\_y]:flex\`, className)} classNames={{ root: cn("a"), "day-button": cn("b"), 1: cn("c"), [k]: cn("z") }}>
    <i data-slot="dot" className={cn("d", { "e f": mode === "dot", "g": open || mode === "line" })} />
  </Picker>
}`)
    expect(slots.map((slot) => slot.name)).toEqual([
      'cal',
      'calRoot',
      'calDayButton',
      'cal1',
      'calK',
      'dotDot',
      'dotOpenOrLine',
      'dot',
    ])
    expect(code).toContain(
      'clsx(styles.dot, mode === "dot" && styles.dotDot, (open || mode === "line") && styles.dotOpenOrLine)',
    )
    expect(components.find((c) => c.name === 'Cal')?.slot).toBe('cal')
  })

  it.each([
    ['a spread in a clsx object', 'const c = <i data-slot="a" className={cn({ ...x })} />'],
    [
      'a keyed class string in an unnamed component',
      'export default () => <P classNames={{ root: cn("x") }} />',
    ],
    [
      'a keyed class string under a computed template key',
      'const c = <P data-slot="a" classNames={{ [`k`]: cn("x") }} />',
    ],
    [
      'a clsx object key without classes',
      'const c = <i data-slot="a" className={cn({ "": x })} />',
    ],
  ])('rejects %s', (_, body) => {
    expect(() => transform(body)).toThrow(/^Unsupported at/)
  })

  it("drops shadcn's cn-* style hooks, and a className left empty", () => {
    const { code, slots } = transform(`function C({ className }) {
  return <i data-slot="c" className={cn("cn-rtl-flip", className)}><b className="cn-rtl-flip" /><u className={cn("x", "cn-a", className)} /><s className={cn("cn-b")} /></i>
}`)
    expect(slots).toEqual([{ name: 'cU', classes: ['x'] }])
    expect(code).toContain(
      '<i data-slot="c" className={clsx(className)}><b /><u className={clsx(styles.cU, className)} /><s className={clsx()} /></i>',
    )
  })

  it('reports group and peer markers with the data-slots they render', () => {
    const { markers } = transformComponent(
      `import { cn } from "cn"
import { cva } from "class-variance-authority"
const xVariants = cva("group/x flex")
function X({ className }) { return <b data-slot="x" className={cn(xVariants({ className }))} /> }
function Y() { return <i className="peer" /> }`,
      'a',
      'bje',
    )
    expect(markers).toEqual([
      { marker: 'group/x', slot: 'x', dataSlots: ['x'] },
      { marker: 'peer', slot: 'yI', dataSlots: [] },
    ])
  })

  it("types another module's cva() props from its function", () => {
    const { code } = transform('type P = VariantProps<typeof toggleVariants>')
    expect(code).toContain(
      'type P = Omit<NonNullable<Parameters<typeof toggleVariants>[0]>, "className">',
    )
  })
})
