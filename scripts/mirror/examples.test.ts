import { describe, expect, it } from 'vitest'
import { prepareExample } from './examples.ts'

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
`

const mirrored = new Set(['button', 'chip', 'odd'])

describe('prepareExample', () => {
  const prepared = prepareExample(example, 'base-vega', 'bje', mirrored)

  it('keeps sub-examples whose reach is available, in the order the page renders them', () => {
    expect(prepared.kept).toEqual(['ChipBasic', 'ChipOdd'])
    expect(prepared.skipped).toEqual([
      { name: 'ChipMenu', missing: ['menu'] },
      { name: 'ChipIcons', missing: ['lucide-react'] },
      { name: 'ChipHook', missing: ['@/registry/base-vega/hooks/use-thing'] },
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
    ['no default export', 'function A() {}', 'the default export renders no sub-example'],
    [
      'an exported sub-example',
      'export default function E() { return <A /> }\nexport function A() {}',
      'unsupported top-level ExportNamedDeclaration at line 2',
    ],
    [
      'a destructured declaration',
      'export default function E() { return <A /> }\nfunction A() {}\nconst { b } = c',
      'unsupported top-level VariableDeclaration at line 3',
    ],
    [
      'a side-effect statement',
      'export default function E() { return <A /> }\nfunction A() {}\nsetup()',
      'unsupported top-level ExpressionStatement at line 3',
    ],
  ])('rejects %s', (_, source, message) => {
    expect(() => prepareExample(source, 'base-vega', 'bje', mirrored)).toThrow(
      `example: ${message}`,
    )
  })
})
