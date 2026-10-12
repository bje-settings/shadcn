import { describe, expect, it } from 'vitest'
import { KNOWN_DIFFERENCES, prepareExample } from './examples.ts'

const example = `"use client"

import * as React from "react"
import { useState } from "react"
import { Example, ExampleWrapper } from "@/registry/base-vega/components/example"
import { Button, type ButtonProps, buttonVariants as variants } from "@/registry/base-vega/ui/button"
import Chip from "@/registry/base-vega/ui/chip"
import type { ChipProps } from "@/registry/base-vega/ui/chip"
import { type Tone, Menu } from "@/registry/base-vega/ui/menu"
import * as Icons from "lucide-react"
import { useThing } from "@/registry/base-vega/hooks/use-thing"
import { IconPlaceholder } from "@/app/(create)/components/icon-placeholder"
import { "odd-name" as Odd } from "@/registry/base-vega/ui/odd"

export default function ChipExample() {
  return (
    <ExampleWrapper>
      <ChipBasic />
      <ChipMenu />
      <ChipIcons />
      <ChipHook />
      <ChipOdd />
      <ChipBorder />
      <ChipBoth />
    </ExampleWrapper>
  )
}

type Label = { text: string }
interface Sizes { sm: string }
const labels: Label[] = [{ text: "a" }]

function Helper({ size }: { size: keyof Sizes }) {
  const [on] = useState(false)
  const props: ChipProps & ButtonProps = { variant: "outline", [size]: on }
  return <Chip {...props} className={variants({ variant: "link" })} />
}

function Unreached() {
  return <Button />
}

function ChipBasic() {
  return (
    <Example title="Basic">
      <Helper size="sm" />
      <IconPlaceholder data-icon="inline-start" />
      <svg:g className="border-b" />
      {labels.map((label) => <Button key={label.text}>{label.text}</Button>)}
      <React.Fragment />
    </Example>
  )
}

function ChipMenu(tone: Tone) {
  return <Menu.Item />
}

function ChipIcons() {
  return <Icons.Star />
}

function ChipHook() {
  useThing()
  return <Chip />
}

function ChipOdd() {
  return <Odd />
}

function ChipBorder() {
  return <Chip className="px-2 border-b" />
}

function ChipBoth() {
  return <Menu.Item className={\`border-t\`} />
}
`

const mirrored = new Set(['button', 'chip', 'odd'])

describe('prepareExample', () => {
  it('uses a default export that renders the page itself as the one sub-example', () => {
    const source = `import { Chip } from "@/registry/base-vega/ui/chip"
export default function ChipPage() {
  const items = ["a"]
  return <div>{items.map((item) => <Chip key={item} />)}</div>
}`
    const prepared = prepareExample(source, 'base-vega', 'bje', mirrored, new Set())
    expect(prepared.kept).toEqual(['ChipPage'])
    const withIcons = prepareExample(
      example,
      'base-vega',
      'bje',
      mirrored,
      new Set(),
      new Set(['lucide-react']),
    )
    expect(withIcons.kept).toContain('ChipIcons')
    expect(prepared.ours).toContain('\nfunction ChipPage() {')
    expect(prepared.ours).not.toContain('export default')
    expect(prepared.ours).toContain('export { ChipPage }')
  })

  // A /create preview card: no default export, its card an exported function,
  // its components imported from upstream's style-neutral bases/base registry.
  const card = `"use client"

import * as React from "react"
import { Card, CardContent } from "@/registry/bases/base/ui/card"
import { Menu } from "@/registry/bases/base/ui/menu"
import { FONTS } from "@/app/(create)/lib/fonts"
import { useDesignSystemSearchParams } from "@/app/(create)/lib/search-params"
import { useDesignSystemSearchParams as useParams } from "@/app/(app)/create/lib/search-params"
import { STYLES } from "@/registry/styles"

export type Tone = "a" | "b"
export const tones: Tone[] = ["a"]

export function StyleCard() {
  const [params] = useDesignSystemSearchParams()
  const [same] = useParams()
  const font = React.useMemo(() => FONTS.find((f) => f.value === params.font), [params.font])
  const style = STYLES.find((s) => s.name === same.style)
  return <Card><CardContent>{font?.name} {style?.title} {tones[0]}</CardContent></Card>
}

export function MenuCard() {
  return <Menu />
}

export function useTone() {
  return tones[0]
}
`
  const withCard = new Set([...mirrored, 'card'])

  it('renders each exported function of a module with no default export', () => {
    const prepared = prepareExample(card, 'bases/base', 'bje', withCard, new Set())
    expect(prepared.kept).toEqual(['StyleCard'])
    expect(prepared.skipped).toEqual([{ name: 'MenuCard', reasons: ['needs menu'] }])
    expect(prepared.ours).toContain('\nfunction StyleCard() {')
    expect(prepared.ours).toContain('\nconst tones: Tone[] = ["a"]')
    expect(prepared.ours).not.toContain('MenuCard')
    // An exported hook is not a sub-example.
    expect(prepared.ours).not.toContain('useTone')
    expect(prepared.ours).toContain('export { StyleCard }')
  })

  it("points the bases/base registry's imports at ours and keeps the stubbed /create internals", () => {
    const prepared = prepareExample(card, 'bases/base', 'bje', withCard, new Set())
    expect(prepared.ours).toContain(
      'import { Card, CardContent } from "@/registry/bje/ui/Card/Card"',
    )
    for (const stubbed of [
      'import { FONTS } from "@/app/(create)/lib/fonts"',
      'import { useDesignSystemSearchParams } from "@/app/(create)/lib/search-params"',
      'import { useDesignSystemSearchParams as useParams } from "@/app/(app)/create/lib/search-params"',
      'import { STYLES } from "@/registry/styles"',
    ]) {
      expect(prepared.ours).toContain(stubbed)
    }
    // As a style's example, the same imports reach nothing mirrored.
    const styled = prepareExample(card, 'base-vega', 'bje', withCard, new Set())
    expect(styled.kept).toEqual([])
  })

  it('keeps sub-examples that import next/image or next/link, which the harness stubs', () => {
    const source = `import Image from "next/image"
import Link from "next/link"
export default function Page() { return <><Pic /><Nav /></> }
function Pic() { return <Image src="a.png" alt="" fill /> }
function Nav() { return <Link href="#">Home</Link> }`
    const stubbed = prepareExample(source, 'base-vega', 'bje', mirrored, new Set())
    expect(stubbed.kept).toEqual(['Pic', 'Nav'])
    expect(stubbed.skipped).toEqual([])
  })

  it('skips a sub-example the mirror is known to render differently, with the reason', () => {
    const source = `import Link from "next/link"
export default function Page() { return <NavigationMenuBasic /> }
function NavigationMenuBasic() { return <Link href="#" /> }`
    const known = prepareExample(source, 'base-vega', 'bje', mirrored, new Set())
    expect(known.kept).toEqual([])
    expect(known.skipped).toEqual([
      { name: 'NavigationMenuBasic', reasons: [KNOWN_DIFFERENCES.get('NavigationMenuBasic')] },
    ])
  })

  const dropped = new Set(['border-b', 'border-t'])
  const prepared = prepareExample(example, 'base-vega', 'bje', mirrored, dropped)

  it('keeps sub-examples whose reach is available, in the order the page renders them', () => {
    expect(prepared.kept).toEqual(['ChipBasic', 'ChipOdd'])
    expect(prepared.skipped).toEqual([
      { name: 'ChipMenu', reasons: ['needs menu'] },
      { name: 'ChipIcons', reasons: ['needs lucide-react'] },
      { name: 'ChipHook', reasons: ['needs @/registry/base-vega/hooks/use-thing'] },
      { name: 'ChipBorder', reasons: ['passes border-b, whose styling the mirror drops'] },
      {
        name: 'ChipBoth',
        reasons: ['needs menu', 'passes border-t, whose styling the mirror drops'],
      },
    ])
  })

  it('trims the upstream copy to what the kept sub-examples reach', () => {
    expect(prepared.upstream).toBe(`"use client"

import * as React from "react"
import { useState } from "react"
import { Example } from "@/registry/base-vega/components/example"
import { Button, type ButtonProps, buttonVariants as variants } from "@/registry/base-vega/ui/button"
import Chip from "@/registry/base-vega/ui/chip"
import type { ChipProps } from "@/registry/base-vega/ui/chip"
import { IconPlaceholder } from "@/app/(create)/components/icon-placeholder"
import { "odd-name" as Odd } from "@/registry/base-vega/ui/odd"

type Label = { text: string }
interface Sizes { sm: string }
const labels: Label[] = [{ text: "a" }]

function Helper({ size }: { size: keyof Sizes }) {
  const [on] = useState(false)
  const props: ChipProps & ButtonProps = { variant: "outline", [size]: on }
  return <Chip {...props} className={variants({ variant: "link" })} />
}

function ChipBasic() {
  return (
    <Example title="Basic">
      <Helper size="sm" />
      <IconPlaceholder data-icon="inline-start" />
      <svg:g className="border-b" />
      {labels.map((label) => <Button key={label.text}>{label.text}</Button>)}
      <React.Fragment />
    </Example>
  )
}

function ChipOdd() {
  return <Odd />
}

export { ChipBasic, ChipOdd }
`)
  })

  it('points registry imports at mirrored components in our copy', () => {
    expect(prepared.ours).toContain(
      'import { Button, type ButtonProps, buttonVariants as variants } from "@/registry/bje/ui/Button/Button"',
    )
    expect(prepared.ours).toContain('import Chip from "@/registry/bje/ui/Chip/Chip"')
    expect(prepared.ours).toContain('import type { ChipProps } from "@/registry/bje/ui/Chip/Chip"')
    expect(prepared.ours).toContain(
      'import { Example } from "@/registry/base-vega/components/example"',
    )
  })

  it.each([
    ['no default export', 'function A() {}', 'no default export, and no exported sub-example'],
    [
      'an export list',
      'export default function E() { return <A /> }\nfunction A() {}\nexport { A }',
      'unsupported top-level ExportNamedDeclaration at line 3',
    ],
    [
      'a module that exports no function',
      'export const A = () => <div />\nexport type B = string',
      'no default export, and no exported sub-example functions',
    ],
    [
      'a default export that renders none of its exported functions',
      'export default () => <div />\nexport function A() { return <div /> }',
      'the default export renders no sub-example functions',
    ],
    [
      'a destructured declaration',
      'export default function E() { return <A /> }\nfunction A() {}\nconst { b } = c',
      'unsupported top-level VariableDeclaration at line 3',
    ],
    [
      'an anonymous default export with no sub-examples',
      'export default () => <div />',
      'the default export renders no sub-example functions',
    ],
    [
      'a side-effect statement',
      'export default function E() { return <A /> }\nfunction A() {}\nsetup()',
      'unsupported top-level ExpressionStatement at line 3',
    ],
  ])('rejects %s', (_, source, message) => {
    expect(() => prepareExample(source, 'base-vega', 'bje', mirrored, new Set())).toThrow(
      `example: ${message}`,
    )
  })
})
