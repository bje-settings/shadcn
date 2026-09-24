// Generates the A/B harness inputs (ab/generated), so every case is generated:
// - each component's upstream source verbatim, and maps from item name to the
//   upstream and mirrored modules;
// - one fixture per exported component and cva() option;
// - each docs example trimmed twice (upstream and ours imports), their module
//   maps and the list of kept sub-examples;
// - Typeset's content fixtures;
// - the upstream page's Tailwind entry and the ours page's example layout CSS.

import { relative } from 'node:path'
import type { MirrorConfig } from './config.ts'
import type { PreparedExample } from './examples.ts'
import { camelCase, registryModule } from './names.ts'
import type { PartTypes, Scaffold } from './parts.ts'
import type { Fixture } from './shapes.ts'
import { exportedNames } from './tests.ts'
import type { TransformedComponent, VariantSet } from './tsx.ts'
import type { TypesetFixture } from './typeset.ts'

export type { Fixture } from './shapes.ts'

export type HarnessInput = {
  name: string
  // A hook item: its upstream copy serves upstream components' imports; it
  // has no fixtures or module map entry
  hook: boolean
  upstreamSource: string
  transformed: TransformedComponent
  types: Map<string, PartTypes>
  scaffolds: Map<string, Scaffold>
  // Parts that need props JSON cannot hold (config testExpressions): no
  // fixture renders them; their item's docs examples do
  expressionParts?: string[]
}

// One fixture per cva() option of each exported component that renders an
// element, or one for a component without options.
export function fixturesFor(input: HarnessInput): Fixture[] {
  const { name, transformed } = input
  const exported = exportedNames(transformed.code)
  const sets = new Map(transformed.variantSets.map((set) => [set.variable, set]))
  return transformed.components
    .filter(
      (component) =>
        exported.has(component.name) &&
        input.types.get(component.name)?.className !== false &&
        !input.expressionParts?.includes(component.name),
    )
    .flatMap((component) => {
      // A component's variantSet always names a cva() the transform recorded.
      const groups = component.variantSet
        ? (sets.get(component.variantSet) as VariantSet).groups
        : []
      const scaffold = input.scaffolds.get(component.name) as Scaffold
      const base = {
        item: name,
        component: component.name,
        ...(component.dataSlot !== undefined ? { slot: component.dataSlot } : {}),
        ancestors: scaffold.ancestors,
        children: scaffold.children,
        // It opens itself (CommandDialog), or an ancestor opens.
        overlay: [scaffold, ...scaffold.ancestors].some((part) => part.props.defaultOpen === true),
      }
      if (groups.length === 0) {
        return [{ ...base, label: component.name, props: scaffold.props }]
      }
      return groups.flatMap((group) =>
        group.options.map((option) => ({
          ...base,
          label: `${component.name} ${group.name}=${option.value}`,
          props: { ...scaffold.props, [group.name]: option.value },
        })),
      )
    })
}

export type HarnessExample = { name: string; prepared: PreparedExample }

// Words an item's camelCase name cannot be as an identifier.
const RESERVED = new Set(['switch', 'default', 'import', 'export', 'new', 'delete', 'function'])

function identifier(name: string): string {
  const id = camelCase(name)
  return RESERVED.has(id) ? `${id}Module` : id
}

function moduleMap(
  exportName: string,
  names: string[],
  specifier: (name: string) => string,
): string {
  return [
    ...names.map(
      (name) => `import * as ${identifier(name)} from ${JSON.stringify(specifier(name))}`,
    ),
    '',
    `export const ${exportName} = {`,
    ...names.map((name) => `  ${JSON.stringify(name)}: ${identifier(name)},`),
    '}',
  ].join('\n')
}

export function harnessFiles(
  config: MirrorConfig,
  harness: {
    components: HarnessInput[]
    examples: HarnessExample[]
    layoutCss: string
    typeset: TypesetFixture[]
  },
  header: string,
): { path: string; content: string }[] {
  const dir = config.harnessDir
  const indexCss = `${config.snapshotDir}/${config.upstream.style}/index.css`
  const typesetCss = `${config.snapshotDir}/typeset/typeset.css`
  const items = harness.components.filter(({ hook }) => !hook)
  const components = items.map(({ name }) => name)
  const examples = harness.examples.map(({ name }) => name)
  const fixtures = items.flatMap(fixturesFor)
  const cases = harness.examples.flatMap(({ name, prepared }) =>
    prepared.kept.map((sub) => ({ example: name, name: sub })),
  )
  const ts = (content: string) => `${header}\n\n${content}\n`
  return [
    ...harness.components.map(({ name, upstreamSource, hook }) => ({
      path: hook ? `${dir}/upstream/hooks/${name}.ts` : `${dir}/upstream/${name}.tsx`,
      content: `${header}\n\n${upstreamSource}`,
    })),
    ...harness.examples.flatMap(({ name, prepared }) =>
      (['upstream', 'ours'] as const).map((side) => ({
        path: `${dir}/examples/${side}/${name}.tsx`,
        content: `${header}\n\n${prepared[side]}`,
      })),
    ),
    {
      path: `${dir}/upstream.ts`,
      content: ts(moduleMap('upstream', components, (n) => `./upstream/${n}`)),
    },
    {
      path: `${dir}/ours.ts`,
      content: ts(moduleMap('ours', components, (name) => registryModule(config.namespace, name))),
    },
    {
      path: `${dir}/examples-upstream.ts`,
      content: ts(moduleMap('upstreamExamples', examples, (n) => `./examples/upstream/${n}`)),
    },
    {
      path: `${dir}/examples-ours.ts`,
      content: ts(moduleMap('oursExamples', examples, (n) => `./examples/ours/${n}`)),
    },
    {
      path: `${dir}/fixtures.ts`,
      content: ts(
        [
          "import type { Fixture } from '../../scripts/mirror/shapes'",
          '',
          `export const fixtures: Fixture[] = ${JSON.stringify(fixtures, null, 2)}`,
        ].join('\n'),
      ),
    },
    {
      path: `${dir}/examples.ts`,
      content: ts(`export const examples = ${JSON.stringify(cases, null, 2)}`),
    },
    {
      path: `${dir}/typeset.ts`,
      content: ts(`export const typeset = ${JSON.stringify(harness.typeset, null, 2)}`),
    },
    {
      path: `${dir}/upstream.css`,
      content: [
        '/* Generated by scripts/mirror. Do not edit. */',
        `@import ${JSON.stringify(relative(dir, indexCss))};`,
        // After Tailwind, as upstream's docs set Typeset up.
        `@import ${JSON.stringify(relative(dir, typesetCss))};`,
        '@source "./upstream";',
        '@source "./examples/upstream";',
        '',
      ].join('\n'),
    },
    { path: `${dir}/examples.css`, content: harness.layoutCss },
  ]
}
