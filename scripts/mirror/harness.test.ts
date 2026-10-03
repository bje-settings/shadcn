import { describe, expect, it } from 'vitest'
import { forStyle, parseConfig } from './config.ts'
import { fixturesFor, harnessFiles } from './harness.ts'
import type { PartTypes, Scaffold } from './parts.ts'
import { type TransformedComponent, transformComponent } from './tsx.ts'

const config = forStyle(
  parseConfig({
    namespace: 'bje',
    upstream: {
      url: 'https://example.com/{style}/{name}.json',
      colorsUrl: 'https://example.com/colors/{name}.json',
      styles: ['base-vega'],
    },
    theme: { baseColor: 'neutral', font: 'inter', iconLibrary: 'lucide' },
    components: ['chip-set'],
    typeset: {
      stylesheet: 'https://example.com/typeset.css',
      fixturesUrl: 'https://example.com/fixtures/{name}.ts',
      fixtures: [],
    },
    snapshotDir: 'upstream',
    outputDir: 'registry/{style}/ui',
    hooksDir: 'registry/{style}/hooks',
    globalsDir: 'registry/{style}/styles',
    harnessDir: 'ab/generated/{style}',
    registryFile: 'registry/{style}/registry.json',
  }),
  'base-vega',
)

const chip = `import { cva } from "class-variance-authority"
import { cn } from "cn"
const chipVariants = cva("flex", { variants: { tone: { soft: "bg-muted", loud: "bg-primary" } } })
const markVariants = cva("grid")
function Chip({ className, tone }) {
  return <span data-slot="chip" className={cn(chipVariants({ tone }), className)} />
}
function ChipMark({ className }) {
  return <i data-slot="chip-mark" className={markVariants({ className })} />
}
function ChipLabel({ className }) {
  return <span data-slot="chip-label" className={cn("text-sm", className)} />
}
function ChipInput({ className }) {
  return <input data-slot="chip-input" className={cn("h-8", className)} />
}
function Internal() {
  return <b data-slot="internal" className="x" />
}
export { Chip, ChipMark, ChipLabel, ChipInput }`

const parts = (transformed: TransformedComponent) => ({
  types: new Map<string, PartTypes>([
    [
      'ChipLabel',
      {
        className: true,
        opens: false,
        keepMounted: false,
        required: [],
        children: 'text',
        options: {},
      },
    ],
  ]),
  scaffolds: new Map<string, Scaffold>(
    transformed.components.map((c) => [
      c.name,
      { ancestors: [], props: {}, children: true, others: [] },
    ]),
  ),
})

describe('fixturesFor', () => {
  it('adds one fixture per cva option, or one per component without options', () => {
    const transformed = transformComponent(chip, 'chip', 'bje')
    const base = { item: 'chip', ancestors: [], children: true, overlay: false }
    expect(
      fixturesFor({
        kind: 'ui',
        name: 'chip',
        upstreamSource: chip,
        expressionParts: [],
        transformed,
        ...parts(transformed),
      }),
    ).toEqual([
      {
        ...base,
        component: 'Chip',
        slot: 'chip',
        label: 'Chip tone=soft',
        props: { tone: 'soft' },
      },
      {
        ...base,
        component: 'Chip',
        slot: 'chip',
        label: 'Chip tone=loud',
        props: { tone: 'loud' },
      },
      { ...base, component: 'ChipMark', slot: 'chip-mark', label: 'ChipMark', props: {} },
      { ...base, component: 'ChipLabel', slot: 'chip-label', label: 'ChipLabel', props: {} },
      { ...base, component: 'ChipInput', slot: 'chip-input', label: 'ChipInput', props: {} },
    ])
  })

  it('renders parts in their scaffold, skips elementless ones, and flags overlays', () => {
    const transformed = transformComponent(chip, 'chip', 'bje')
    const scaffold: Scaffold = {
      ancestors: [{ component: 'Chip', props: { defaultOpen: true } }],
      props: { value: 'a', tone: 'soft' },
      children: false,
      others: [],
    }
    const fixtures = fixturesFor({
      kind: 'ui',
      name: 'chip',
      upstreamSource: chip,
      expressionParts: [],
      transformed,
      types: new Map([
        [
          'ChipMark',
          {
            className: false,
            opens: true,
            keepMounted: false,
            required: [],
            children: 'text',
            options: {},
          },
        ],
      ]),
      scaffolds: new Map([
        ...parts(transformed).scaffolds,
        ['Chip', scaffold],
        ['ChipLabel', scaffold],
      ]),
    })
    expect(fixtures.map((f) => f.label)).toEqual([
      'Chip tone=soft',
      'Chip tone=loud',
      'ChipLabel',
      'ChipInput',
    ])
    expect(fixtures[1]).toMatchObject({ props: { value: 'a', tone: 'loud' }, overlay: true })
    expect(fixtures[2]).toMatchObject({ children: false, overlay: true })
  })
})

describe('harnessFiles', () => {
  it('writes upstream copies, example copies, module maps, case lists, both stylesheets and a tsconfig', () => {
    const transformed = transformComponent(chip, 'chip-set', 'bje')
    const files = harnessFiles(
      config,
      {
        components: [
          {
            kind: 'ui',
            name: 'chip-set',
            upstreamSource: chip,
            expressionParts: [],
            transformed,
            ...parts(transformed),
          },
        ],
        examples: [
          {
            name: 'chip-set-example',
            prepared: { upstream: 'up', ours: 'our', kept: ['ChipBasic'], skipped: [] },
          },
        ],
        layoutCss: '/* layout */',
        typeset: [{ name: 'docs', html: '<h1>Docs</h1>' }],
      },
      '// header',
    )
    const byPath = Object.fromEntries(files.map((file) => [file.path, file.content]))
    expect(Object.keys(byPath)).toEqual([
      'ab/generated/vega/upstream/chip-set.tsx',
      'ab/generated/vega/examples/upstream/chip-set-example.tsx',
      'ab/generated/vega/examples/ours/chip-set-example.tsx',
      'ab/generated/vega/upstream.ts',
      'ab/generated/vega/ours.ts',
      'ab/generated/vega/examples-upstream.ts',
      'ab/generated/vega/examples-ours.ts',
      'ab/generated/vega/fixtures.ts',
      'ab/generated/vega/examples.ts',
      'ab/generated/vega/typeset.ts',
      'ab/generated/vega/upstream.css',
      'ab/generated/vega/examples.css',
      'ab/generated/vega/tsconfig.json',
    ])
    expect(byPath['ab/generated/vega/upstream/chip-set.tsx']).toBe(`// header\n\n${chip}`)
    expect(byPath['ab/generated/vega/examples/ours/chip-set-example.tsx']).toBe('// header\n\nour')
    expect(byPath['ab/generated/vega/upstream.ts']).toContain(
      'import * as chipSet from "./upstream/chip-set"\n\nexport const upstream = {\n  "chip-set": chipSet,\n}',
    )
    expect(byPath['ab/generated/vega/ours.ts']).toContain(
      'import * as chipSet from "@/registry/bje/ui/ChipSet/ChipSet"',
    )
    expect(byPath['ab/generated/vega/examples-ours.ts']).toContain(
      'import * as chipSetExample from "./examples/ours/chip-set-example"',
    )
    expect(byPath['ab/generated/vega/fixtures.ts']).toContain('"label": "Chip tone=soft"')
    expect(byPath['ab/generated/vega/fixtures.ts']).toContain(
      "import type { Fixture } from '../../../scripts/mirror/shapes'",
    )
    expect(byPath['ab/generated/vega/examples.ts']).toContain(
      '"example": "chip-set-example",\n    "name": "ChipBasic"',
    )
    expect(byPath['ab/generated/vega/upstream.css']).toContain(
      '@import "../../../upstream/base-vega/index.css";\n@import "../../../upstream/typeset/typeset.css";\n@source "./upstream";\n@source "./examples/upstream";',
    )
    expect(byPath['ab/generated/vega/typeset.ts']).toContain('"html": "<h1>Docs</h1>"')
    expect(byPath['ab/generated/vega/examples.css']).toBe('/* layout */')
    expect(JSON.parse(byPath['ab/generated/vega/tsconfig.json'] as string)).toEqual({
      extends: '../../tsconfig.json',
      compilerOptions: {
        paths: {
          '@ab/generated/*': ['./*'],
          '@ab/styles/*': ['../../../registry/vega/styles/*'],
          '@/registry/bje/ui/*': ['../../../registry/vega/ui/*'],
          '@/registry/bje/hooks/*': ['../../../registry/vega/hooks/*'],
          '@/registry/base-vega/ui/*': ['./upstream/*'],
          '@/registry/base-vega/hooks/*': ['./upstream/hooks/*'],
          '@/registry/base-vega/components/example': ['../../stubs/example.tsx'],
          '@/app/(create)/components/icon-placeholder': ['../../stubs/icon-placeholder.tsx'],
          'next/image': ['../../stubs/next-image.tsx'],
          'next/link': ['../../stubs/next-link.tsx'],
        },
      },
    })
  })

  it('copies a hook item to upstream/hooks, with no fixtures or module map entry', () => {
    const files = harnessFiles(
      config,
      {
        components: [
          {
            kind: 'hook',
            name: 'use-thing',
            upstreamSource: 'export function useThing() { return 1 }',
          },
        ],
        examples: [],
        layoutCss: '',
        typeset: [],
      },
      '// header',
    )
    const byPath = Object.fromEntries(files.map((file) => [file.path, file.content]))
    expect(byPath['ab/generated/vega/upstream/hooks/use-thing.ts']).toBe(
      '// header\n\nexport function useThing() { return 1 }',
    )
    expect(byPath['ab/generated/vega/upstream.ts']).not.toContain('use-thing')
    expect(byPath['ab/generated/vega/ours.ts']).not.toContain('use-thing')
    expect(byPath['ab/generated/vega/fixtures.ts']).toContain(
      'export const fixtures: Fixture[] = []',
    )
  })
})
