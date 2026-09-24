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
    const { code, slots } = transformComponent(button, 'button')
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
    const { code, slots } = transformComponent(source, 'button')
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
    const { code, slots } = transformComponent(source, 'card')
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
    const source = 'import { cva } from "class-variance-authority"\nconst a = 1'
    expect(transformComponent(source, 'x').code).toBe(
      '\nimport styles from "./X.module.scss"\nconst a = 1',
    )
  })

  it.each([
    ['cva in a multi-variable declaration', 'const a = cva("x"), b = 1'],
    ['cva with no base', 'const aVariants = cva()'],
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
    ['VariantProps of an unknown value', 'type P = VariantProps<typeof other>'],
    ['VariantProps without a typeof', 'type P = VariantProps<Other>'],
    ['VariantProps of a member', 'type P = VariantProps<typeof a.b>'],
    ['a conditional cn() argument', 'const c = cn(a ? "x" : "y")'],
    ['cn() strings outside JSX', 'const c = cn("x")'],
    ['cn() strings without data-slot', 'const c = <div className={cn("x")} />'],
    [
      'cn() strings when data-slot is an expression',
      'const c = <div data-slot={slot} className={cn("x")} />',
    ],
    ['a className string without data-slot', 'const c = <div className="x" />'],
    ['a template className', 'const c = <div className={`x`} />'],
    [
      'one slot with different classes',
      'const c = <><div data-slot="a" className="x" /><div data-slot="a" className="y" /></>',
    ],
  ])('rejects %s', (_, source) => {
    expect(() => transformComponent(source, 'a')).toThrow(/^Unsupported at \d+:\d+: /)
  })
})
