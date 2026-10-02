// One upstream registry item in, the mirror's files and registry entry out.

import { parseModule } from './ast.ts'
import { consumerClassReasons, type MirrorConfig } from './config.ts'
import { installTransforms } from './install.ts'
import { pascalCase } from './names.ts'
import type { ItemParts } from './parts.ts'
import {
  NAMED_TEXT_SIZE,
  SIZE_ATTRIBUTE,
  SIZE_PROBE,
  type SlotOptions,
  slotToScss,
} from './scss.ts'
import { generateTest } from './tests.ts'
import { type TransformedComponent, transformComponent } from './tsx.ts'

export type UpstreamItem = {
  name: string
  type: string
  dependencies?: string[]
  registryDependencies?: string[]
  files: { path: string; type: string; content?: string }[]
}

type ItemType = 'registry:ui' | 'registry:hook' | 'registry:file'

export type RegistryItem = {
  name: string
  type: ItemType
  title: string
  dependencies: string[]
  devDependencies: string[]
  registryDependencies: string[]
  files: { path: string; type: ItemType; target?: string }[]
}

export type GeneratedComponent = {
  item: RegistryItem
  files: { path: string; content: string }[]
  // Upstream classes Tailwind produced no CSS for, by module class.
  unresolved: Record<string, string[]>
  // Why rules were dropped or loosened, as the module's header lists them
  dropped: string[]
  // Every upstream class the component uses, for the global stylesheets.
  classes: string[]
  // Upstream's source and what the transform learned, for the A/B harness.
  upstreamSource: string
  transformed: TransformedComponent
  // Internal variables the module declares, and every other custom property it
  // uses, for the collision check across the registry.
  internal: string[]
  external: string[]
}

// Packages consumers already have, which shadcn items never list.
const IMPLICIT = new Set(['react', 'react-dom'])

// Needed but never imported: Sass to compile the .module.scss, and, to run the
// shipped test, Testing Library's peer dependency and the DOM environment.
const BUILD_AND_TEST_RUNTIME = ['sass', '@testing-library/dom', 'jsdom']

function packageName(specifier: string): string {
  const parts = specifier.split('/')
  return (specifier.startsWith('@') ? parts.slice(0, 2) : parts.slice(0, 1)).join('/')
}

export function dependenciesOf(code: string): string[] {
  const ast = parseModule(code)
  const packages = new Set<string>()
  for (const statement of ast.program.body) {
    if (statement.type !== 'ImportDeclaration') continue
    const specifier = statement.source.value
    if (specifier.startsWith('.') || specifier.startsWith('@/')) continue
    const name = packageName(specifier)
    if (!IMPLICIT.has(name)) packages.add(name)
  }
  return [...packages].sort()
}

function wrap(label: string, values: string[]): string[] {
  if (values.length === 0) return []
  const lines = ['//', `// ${label}`]
  let line = '//  '
  for (const value of values) {
    if (line.length + value.length + 1 > 100) {
      lines.push(line)
      line = '//  '
    }
    line += ` ${value}`
  }
  lines.push(line)
  return lines
}

// An upstream component as `shadcn add` would write it, and its transform.
// Every component is prepared before any is built, since a group or peer
// marker one component carries can style another.
export type PreparedComponent = {
  upstream: UpstreamItem
  // Upstream's source after the CLI's install transforms
  installed: string
  transformed: TransformedComponent
}

function where(config: MirrorConfig, upstream: UpstreamItem): string {
  return `${config.upstream.style}/${upstream.name}`
}

export async function prepareComponent(
  upstream: UpstreamItem,
  config: MirrorConfig,
  cssPath: string,
): Promise<PreparedComponent> {
  if (upstream.type !== 'registry:ui' && upstream.type !== 'registry:hook') {
    throw new Error(`${where(config, upstream)}: type ${upstream.type} is not supported yet`)
  }
  const [file, ...extra] = upstream.files
  if (!file?.content || extra.length > 0) {
    throw new Error(`${where(config, upstream)}: expected exactly one file with content`)
  }
  const installed = await installTransforms(file.content, config, cssPath)
  return {
    upstream,
    installed,
    transformed: transformComponent(installed, upstream.name, config.namespace),
  }
}

// The selector each group/peer marker becomes in one component's module:
// `[data-slot="x"]` for every element, in any mirrored component, that
// carries the marker and renders a data-slot; the module class of this
// component's own elements that render none.
export function markerSelectors(
  components: PreparedComponent[],
  component: PreparedComponent,
): Map<string, string> {
  const selectors = new Map<string, Set<string>>()
  const add = (marker: string, selector: string) => {
    selectors.set(marker, (selectors.get(marker) ?? new Set()).add(selector))
  }
  for (const { transformed } of components) {
    for (const { marker, slot, dataSlots } of transformed.markers) {
      for (const value of dataSlots) add(marker, `[data-slot="${value}"]`)
      if (dataSlots.length === 0 && transformed === component.transformed) add(marker, `.${slot}`)
    }
  }
  return new Map(
    [...selectors].map(([marker, set]) => {
      const list = [...set].sort()
      return [marker, list.length === 1 ? (list[0] as string) : `:is(${list.join(', ')})`]
    }),
  )
}

// What upstream's `[class*="<fragment>"]` finds among mirrored elements: the
// data-slot of every element whose upstream classes contain the fragment
// (Spinner's `size-4` for `svg:not([class*="size-"])`).
export function classProbe(components: PreparedComponent[]): (fragment: string) => string[] {
  return (fragment) =>
    components.flatMap(({ transformed }) =>
      transformed.slots
        .filter((slot) => slot.classes.join(' ').includes(fragment))
        .flatMap((slot) => [
          ...(transformed.dataSlots[slot.name] ?? []).map((v) => `[data-slot="${v}"]`),
          ...(fragment === SIZE_PROBE && transformed.sized.includes(slot.name)
            ? [`[${SIZE_ATTRIBUTE}]`]
            : []),
        ]),
    )
}

// The data-slot of every mirrored element whose slot sets a named font size
// and no leading, unless a slot with a leading carries the same data-slot.
export function textSizedSelectors(components: PreparedComponent[]): string[] {
  const sized = new Set<string>()
  const led = new Set<string>()
  for (const { transformed } of components) {
    for (const slot of transformed.slots) {
      const target = slot.classes.some((c) => c.startsWith('leading-'))
        ? led
        : slot.classes.some((c) => NAMED_TEXT_SIZE.test(c))
          ? sized
          : undefined
      for (const value of transformed.dataSlots[slot.name] ?? []) target?.add(value)
    }
  }
  return [...sized]
    .filter((value) => !led.has(value))
    .sort()
    .map((value) => `[data-slot="${value}"]`)
}

// The rank of each class probe default among the others with the same
// variant, over every mirrored component: Tailwind sorts equal-specificity
// utilities by candidate, so the greater candidate comes later and wins
// where two ancestors' defaults reach one icon.
export function probeRanks(
  components: PreparedComponent[],
): (candidate: string, variant: boolean) => number {
  const groups = new Map<string, Set<string>>()
  for (const { transformed } of components) {
    for (const slot of transformed.slots) {
      for (const candidate of slot.classes) {
        const cut = candidate.lastIndexOf(':')
        if (cut < 0 || !candidate.includes('[class*=')) continue
        const variant = candidate.slice(0, cut)
        groups.set(variant, (groups.get(variant) ?? new Set()).add(candidate))
      }
    }
  }
  const ranks = new Map<string, { rank: number; span: number }>()
  for (const group of groups.values()) {
    for (const [rank, candidate] of [...group].sort().entries()) {
      ranks.set(candidate, { rank, span: group.size })
    }
  }
  return (candidate, variant) => {
    const found = ranks.get(candidate)
    return found ? found.rank + (variant ? found.span : 0) : 0
  }
}

// What slotToScss reads besides each component's own markers: the same for
// every component, so built once.
export function sharedSlotOptions(
  config: MirrorConfig,
  components: PreparedComponent[],
  internalDefaults: Map<string, string>,
): Omit<SlotOptions, 'markers'> {
  return {
    internalDefaults,
    classProbe: classProbe(components),
    textSized: textSizedSelectors(components),
    probeRank: probeRanks(components),
    consumerClasses: consumerClassReasons(config),
    globalClasses: new Set(config.globalClasses.flatMap(({ classes }) => classes)),
    withoutCss: new Set(config.classesWithoutCss.flatMap(({ classes }) => classes)),
  }
}

export async function buildComponent(
  prepared: PreparedComponent,
  config: MirrorConfig,
  compile: (candidates: string[]) => Promise<string>,
  context: ItemParts & { slotOptions: SlotOptions },
): Promise<GeneratedComponent> {
  const { upstream, transformed: source } = prepared
  const setup = config.testSetup.filter(({ items }) => items.includes(upstream.name))
  const component = pascalCase(upstream.name)
  const hook = upstream.type === 'registry:hook'
  // A component in its PascalCase folder; a hook by name, as upstream.
  const base = hook
    ? `${config.hooksDir}/${upstream.name}`
    : `${config.outputDir}/${component}/${component}`

  // Upstream's bare names mean official shadcn items; each must be mirrored
  // too, and becomes a dependency on this registry's copy.
  const registryDependencies = [
    ...new Set([...(upstream.registryDependencies ?? []), ...source.registryImports]),
  ].map((dependency) => {
    if (!config.components.includes(dependency)) {
      throw new Error(
        `${where(config, upstream)}: depends on ${dependency}, which mirror.config.json does not list`,
      )
    }
    return `@${config.namespace}/${dependency}`
  })
  // Every component reads the global variables and relies on the base layer.
  if (!hook) registryDependencies.push(`@${config.namespace}/globals`)
  const generated = `// Generated by scripts/mirror from shadcn ${where(config, upstream)}. Do not edit.`

  const blocks = []
  const defaults = new Map<string, string>()
  const defaultSelectors = new Set<string>()
  const internal = new Set<string>()
  const external = new Set<string>()
  const unresolved: Record<string, string[]> = {}
  const properties = new Set<string>()
  const dropped = new Set<string>()
  // Slots the module exports no class for.
  const unstyled = new Set<string>()
  for (const slot of source.slots) {
    const block = slotToScss(await compile(slot.classes), slot, context.slotOptions)
    blocks.push(block.scss)
    // One table serves every slot, so a name always has the same default.
    for (const [name, value] of Object.entries(block.defaults)) defaults.set(name, value)
    for (const selector of block.defaultSelectors) defaultSelectors.add(selector)
    for (const name of block.internal) internal.add(name)
    for (const name of block.external) external.add(name)
    if (block.empty) unstyled.add(slot.name)
    if (block.unresolved.length > 0) unresolved[slot.name] = block.unresolved
    for (const property of block.customProperties) properties.add(property)
    for (const reason of block.dropped) dropped.add(reason)
  }

  const scss = [
    generated,
    ...wrap(
      'Custom properties read here and set elsewhere (tokens, enclosing slots, inline styles):',
      [...properties].sort(),
    ),
    ...wrap('Upstream classes with no CSS output, dropped:', Object.values(unresolved).flat()),
    ...[...dropped].flatMap((reason) => ['//', `// Dropped rules: ${reason}`]),
    '',
    // Tailwind registers these globally with @property. A layer loses to every
    // unlayered rule, and each module declares the same constants, so modules
    // never conflict.
    ...(defaults.size > 0
      ? [
          '// Defaults for the internal variables the rules below compose with.',
          '@layer properties {',
          `  ${[...defaultSelectors].sort().join(',\n  ')} {`,
          ...[...defaults]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([n, v]) => `    ${n}: ${v};`),
          '  }',
          '}',
          '',
        ]
      : []),
    blocks.join('\n\n'),
    '',
  ].join('\n')
  const test = generateTest(upstream.name, source, {
    types: context.types,
    scaffolds: context.scaffolds,
    external: context.external,
    setup,
    unstyled,
    unrendered: config.unrenderedInTests[upstream.name] ?? {},
    ...(hook ? { module: upstream.name } : {}),
    expressions: config.testExpressions[upstream.name] ?? {},
    sameRender: config.sameRenderInTests[upstream.name] ?? {},
  })
  const files = [
    {
      path: `${base}.${hook ? 'ts' : 'tsx'}`,
      content: `${generated}\n\n${source.code}`,
    },
    ...(source.slots.length > 0 ? [{ path: `${base}.module.scss`, content: scss }] : []),
    {
      path: `${base}.test.tsx`,
      content: `${generated}\n\n${test}`,
    },
  ]
  // Upstream's version pins (recharts@3.8.0) for the packages it imports.
  const pinned = (name: string) =>
    upstream.dependencies?.find((dependency) => dependency.startsWith(`${name}@`)) ?? name
  const type: ItemType = hook ? 'registry:hook' : 'registry:ui'

  return {
    item: {
      name: upstream.name,
      type,
      title: component,
      dependencies: dependenciesOf(source.code).map(pinned),
      devDependencies: [
        ...new Set([
          ...dependenciesOf(test),
          ...BUILD_AND_TEST_RUNTIME.filter((dependency) => !hook || dependency !== 'sass'),
        ]),
      ].sort(),
      registryDependencies,
      files: files.map(({ path }) => ({ path, type })),
    },
    files,
    unresolved,
    dropped: [...dropped],
    classes: [...new Set(source.slots.flatMap((slot) => slot.classes))],
    upstreamSource: prepared.installed,
    transformed: source,
    internal: [...internal].sort(),
    external: [...external].sort(),
  }
}
