// One upstream registry item in, the mirror's files and registry entry out.

import { parseModule } from './ast.ts'
import { consumerClassReasons, type MirrorConfig } from './config.ts'
import { installTransforms } from './install.ts'
import { pascalCase } from './names.ts'
import type { PartTypes, Scaffold } from './parts.ts'
import { slotToScss } from './scss.ts'
import { generateTest } from './tests.ts'
import { type TransformedComponent, transformComponent } from './tsx.ts'

export type UpstreamItem = {
  name: string
  type: string
  registryDependencies?: string[]
  files: { path: string; type: string; content?: string }[]
}

export type RegistryItem = {
  name: string
  type: 'registry:ui' | 'registry:file'
  title: string
  dependencies: string[]
  devDependencies: string[]
  registryDependencies: string[]
  files: { path: string; type: 'registry:ui' | 'registry:file'; target?: string }[]
}

export type GeneratedComponent = {
  item: RegistryItem
  files: { path: string; content: string }[]
  // Upstream classes Tailwind produced no CSS for, by module class.
  unresolved: Record<string, string[]>
  // Every upstream class the component uses, for the global stylesheets.
  classes: string[]
  // Upstream's source and what the transform learned, for the A/B harness.
  upstreamSource: string
  transformed: TransformedComponent
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
  if (upstream.type !== 'registry:ui') {
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
        .flatMap((slot) =>
          (transformed.dataSlots[slot.name] ?? []).map((v) => `[data-slot="${v}"]`),
        ),
    )
}

export async function buildComponent(
  prepared: PreparedComponent,
  config: MirrorConfig,
  compile: (candidates: string[]) => Promise<string>,
  context: {
    markers: Map<string, string>
    classProbe: (fragment: string) => string[]
    types: Map<string, PartTypes>
    scaffolds: Map<string, Scaffold>
    external: Map<string, PartTypes>
  },
): Promise<GeneratedComponent> {
  const setup = config.testSetup.filter(({ items }) => items.includes(prepared.upstream.name))
  const { upstream, transformed: source } = prepared
  const component = pascalCase(upstream.name)
  const dir = `${config.outputDir}/${component}`

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
  registryDependencies.push(`@${config.namespace}/globals`)
  const generated = `// Generated by scripts/mirror from shadcn ${where(config, upstream)}. Do not edit.`

  const blocks = []
  const unresolved: Record<string, string[]> = {}
  const properties = new Set<string>()
  const dropped = new Set<string>()
  const options = {
    markers: context.markers,
    classProbe: context.classProbe,
    consumerClasses: consumerClassReasons(config),
    globalClasses: new Set(config.globalClasses.flatMap(({ classes }) => classes)),
    withoutCss: new Set(config.classesWithoutCss.flatMap(({ classes }) => classes)),
  }
  // Slots the module exports no class for.
  const unstyled = new Set<string>()
  for (const slot of source.slots) {
    const block = slotToScss(await compile(slot.classes), slot, options)
    blocks.push(block.scss)
    if (block.empty) unstyled.add(slot.name)
    if (block.unresolved.length > 0) unresolved[slot.name] = block.unresolved
    for (const property of block.customProperties) properties.add(property)
    for (const reason of block.dropped) dropped.add(reason)
  }

  const scss = [
    generated,
    ...wrap('Custom properties read here and provided globally:', [...properties].sort()),
    ...wrap('Upstream classes with no CSS output, dropped:', Object.values(unresolved).flat()),
    ...[...dropped].flatMap((reason) => ['//', `// Dropped rules: ${reason}`]),
    '',
    blocks.join('\n\n'),
    '',
  ].join('\n')
  const test = generateTest(upstream.name, source, {
    ...context,
    setup,
    unstyled,
    unrendered: config.unrenderedInTests[upstream.name] ?? {},
  })
  const files = [
    {
      path: `${dir}/${component}.tsx`,
      content: `${generated}\n\n${source.code}`,
    },
    ...(source.slots.length > 0
      ? [{ path: `${dir}/${component}.module.scss`, content: scss }]
      : []),
    {
      path: `${dir}/${component}.test.tsx`,
      content: `${generated}\n\n${test}`,
    },
  ]

  return {
    item: {
      name: upstream.name,
      type: 'registry:ui',
      title: component,
      dependencies: dependenciesOf(source.code),
      devDependencies: [...new Set([...dependenciesOf(test), ...BUILD_AND_TEST_RUNTIME])].sort(),
      registryDependencies,
      files: files.map(({ path }) => ({ path, type: 'registry:ui' })),
    },
    files,
    unresolved,
    classes: [...new Set(source.slots.flatMap((slot) => slot.classes))],
    upstreamSource: prepared.installed,
    transformed: source,
  }
}
