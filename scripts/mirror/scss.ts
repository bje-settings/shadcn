// Turns Tailwind's flattened output for one slot's classes into a nested SCSS
// block under a single module class.
//
// Every utility rule is `[@media|@supports wrappers] <selector containing the
// utility class> { declarations }`. The utility class becomes `&`, the rule
// nests under the slot's class, and adjacent rules that share a selector and
// wrappers merge. Order is preserved exactly: Tailwind emits utilities in
// cascade order, and only adjacent blocks merge, so no declaration moves past
// another that could override it.
//
// The slot class is wrapped in :where() so a consumer's className always
// outranks the component's defaults, the job tailwind-merge does upstream.

import postcss, { type AtRule, type Rule } from 'postcss'
import selectorParser from 'postcss-selector-parser'
import type { SelectorRewrite } from './config.ts'

export type Slot = {
  // camelCase module class name
  name: string
  classes: string[]
}

export type ScssBlock = {
  scss: string
  // Classes Tailwind produced no CSS for, e.g. group/peer markers.
  unresolved: string[]
  // Custom properties the block reads but does not set: the global variables
  // file has to provide them.
  customProperties: string[]
}

type Item = { decl: string } | Block
type Block = { key: string; items: Item[] }

function isBlock(item: Item | undefined): item is Block {
  return item !== undefined && 'items' in item
}

function wrappersOf(rule: Rule, layer: AtRule): string[] {
  const wrappers: string[] = []
  // Everything between a utility rule and the utilities layer is an at-rule.
  for (let node = rule.parent as AtRule; node !== layer; node = node.parent as AtRule) {
    wrappers.unshift(`@${node.name} ${node.params}`)
  }
  return wrappers
}

function nestSelector(selector: string, candidates: Set<string>, resolved: Set<string>): string {
  return selectorParser((root) => {
    root.walkClasses((node) => {
      if (!candidates.has(node.value)) return
      resolved.add(node.value)
      node.replaceWith(selectorParser.nesting({ value: '&' }))
    })
  }).processSync(selector)
}

function insert(root: Block, path: string[], decls: string[]): void {
  let block = root
  for (const key of path) {
    const last = block.items.at(-1)
    if (isBlock(last) && last.key === key) {
      block = last
    } else {
      const child: Block = { key, items: [] }
      block.items.push(child)
      block = child
    }
  }
  block.items.push(...decls.map((decl) => ({ decl })))
}

function print(block: Block, depth: number): string[] {
  const indent = '  '.repeat(depth)
  const lines = [`${indent}${block.key} {`]
  for (const item of block.items) {
    if (isBlock(item)) lines.push(...print(item, depth + 1))
    else lines.push(`${indent}  ${item.decl};`)
  }
  lines.push(`${indent}}`)
  return lines
}

export function slotToScss(css: string, slot: Slot, rewrites: SelectorRewrite[]): ScssBlock {
  const candidates = new Set(slot.classes)
  const resolved = new Set<string>()
  const root: Block = { key: `:where(.${slot.name})`, items: [] }
  const reads = new Set<string>()
  const sets = new Set<string>()

  const layer = postcss
    .parse(css)
    .nodes.find(
      (node): node is AtRule =>
        node.type === 'atrule' && node.name === 'layer' && node.params === 'utilities',
    )

  layer?.walkRules((rule) => {
    const selectors = [
      ...new Set(
        rule.selectors.map((selector) =>
          rewrites.reduce(
            (result, { find, replace }) => result.split(find).join(replace),
            nestSelector(selector, candidates, resolved),
          ),
        ),
      ),
    ]
    const decls: string[] = []
    rule.walkDecls((decl) => {
      if (decl.prop.startsWith('--')) sets.add(decl.prop)
      for (const [, name] of decl.value.matchAll(/var\((--[\w-]+)/g)) reads.add(name as string)
      decls.push(`${decl.prop}: ${decl.value}${decl.important ? ' !important' : ''}`)
    })
    const selector = selectors.join(', ')
    const wrappers = wrappersOf(rule, layer)
    insert(root, selector === '&' ? wrappers : [selector, ...wrappers], decls)
  })

  return {
    scss: print(root, 0).join('\n'),
    unresolved: slot.classes.filter((c) => !resolved.has(c)),
    customProperties: [...reads].filter((name) => !sets.has(name)).sort(),
  }
}
