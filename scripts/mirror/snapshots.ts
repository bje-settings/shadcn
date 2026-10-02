// Parsers for the upstream JSON the mirror snapshots: registry items, the
// style index, the base color and the font. Each checks exactly the fields
// the pipeline reads.

import type { UpstreamItem } from './component.ts'
import { Shape } from './parse.ts'
import type { BaseColor, CssTree, FontItem, StyleIndex } from './project-css.ts'

export function parseUpstreamItem(raw: unknown, where: string): UpstreamItem {
  const shape: Shape = new Shape(where)
  const item = shape.record(raw, 'item')
  const files = item.files
  if (!Array.isArray(files)) shape.fail('files must be an array')
  return {
    name: shape.string(item.name, 'name'),
    type: shape.string(item.type, 'type'),
    ...(item.dependencies === undefined
      ? {}
      : { dependencies: shape.strings(item.dependencies, 'dependencies') }),
    ...(item.registryDependencies === undefined
      ? {}
      : { registryDependencies: shape.strings(item.registryDependencies, 'registryDependencies') }),
    files: files.map((file: unknown, i) => {
      const entry = shape.record(file, `files[${i}]`)
      return {
        path: shape.string(entry.path, `files[${i}].path`),
        type: shape.string(entry.type, `files[${i}].type`),
        ...(entry.content === undefined
          ? {}
          : { content: shape.string(entry.content, `files[${i}].content`) }),
      }
    }),
  }
}

function cssTree(shape: Shape, value: unknown, path: string): CssTree {
  const record = shape.record(value, path)
  return Object.fromEntries(
    Object.entries(record).map(([key, child]) => [key, cssTree(shape, child, `${path}["${key}"]`)]),
  )
}

export function parseStyleIndex(raw: unknown, where: string): StyleIndex {
  const shape: Shape = new Shape(where)
  const index = shape.record(raw, 'item')
  return index.css === undefined ? {} : { css: cssTree(shape, index.css, 'css') }
}

export function parseBaseColor(raw: unknown, where: string): BaseColor {
  const shape: Shape = new Shape(where)
  const vars = shape.record(shape.record(raw, 'item').cssVarsV4, 'cssVarsV4')
  return {
    cssVarsV4: {
      light: shape.stringRecord(vars.light, 'cssVarsV4.light'),
      dark: shape.stringRecord(vars.dark, 'cssVarsV4.dark'),
    },
  }
}

// The title names the @<namespace>/font-<name> item.
export type FontSnapshot = FontItem & { title: string }

export function parseFontItem(raw: unknown, where: string): FontSnapshot {
  const shape: Shape = new Shape(where)
  const item = shape.record(raw, 'item')
  const font = shape.record(item.font, 'font')
  const variable = shape.string(font.variable, 'font.variable')
  if (!variable.startsWith('--')) shape.fail('font.variable must be a custom property')
  return {
    title: shape.string(item.title, 'title'),
    font: {
      family: shape.string(font.family, 'font.family'),
      variable,
      dependency: shape.string(font.dependency, 'font.dependency'),
    },
  }
}
