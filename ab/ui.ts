// A page's component modules by item name: the generated upstream or ours map.

import type { ComponentType } from 'react'

export type Ui = Record<string, Record<string, unknown>>

export function pick(ui: Ui, item: string, name: string): ComponentType<Record<string, unknown>> {
  const component = ui[item]?.[name]
  if (typeof component !== 'function') throw new Error(`no ${name} in ${item}`)
  return component as ComponentType<Record<string, unknown>>
}
