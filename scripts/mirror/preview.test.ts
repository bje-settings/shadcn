import { describe, expect, it } from 'vitest'
import { forStyle, parseConfig } from './config.ts'
import type { PreparedExample } from './examples.ts'
import {
  previewCards,
  type ShowcaseCard,
  showcaseFiles,
  showcaseIndex,
  skippedCards,
} from './preview.ts'

const cards = '@/registry/bases/base/blocks/preview/cards'

// An index as upstream writes one: cards imported by name, rendered in an
// order of their own, one twice (a column swap at a breakpoint).
const index = `"use client"

import * as React from "react"
import { Invoice } from "${cards}/invoice"
import { StyleOverview } from "${cards}/style-overview"
import { UIElements } from "${cards}/ui-elements"
import { Button } from "@/registry/bases/base/ui/button"

export default function PreviewExample() {
  return (
    <div className="grid">
      <div><StyleOverview /><div className="md:hidden"><UIElements /></div></div>
      <div><div className="hidden md:flex"><UIElements /></div><Invoice /></div>
    </div>
  )
}
`

describe('previewCards', () => {
  it('lists the cards the index imports, in the order it first renders them', () => {
    expect(previewCards('preview', index)).toEqual([
      { file: 'cards/style-overview.tsx', name: 'style-overview', component: 'StyleOverview' },
      { file: 'cards/ui-elements.tsx', name: 'ui-elements', component: 'UIElements' },
      { file: 'cards/invoice.tsx', name: 'invoice', component: 'Invoice' },
    ])
  })

  it('keeps a card the index imports but does not render, after the rendered ones', () => {
    const unrendered = `import { A } from "${cards}/a"\nimport { B } from "${cards}/b"\nexport default () => <B />`
    expect(previewCards('preview', unrendered).map(({ name }) => name)).toEqual(['b', 'a'])
  })

  it('names the card by the function it imports, under any local name', () => {
    const aliased = `import { Invoice as Bill } from "${cards}/invoice"\nexport default () => <Bill />`
    expect(previewCards('preview', aliased)).toEqual([
      { file: 'cards/invoice.tsx', name: 'invoice', component: 'Invoice' },
    ])
  })

  it.each([
    [
      'an index that imports no card',
      'import { Button } from "@/registry/bases/base/ui/button"\nexport default () => <Button />',
      'preview preview/index.tsx: imports no card from @/registry/bases/base/blocks/preview/',
    ],
    [
      "another block's cards",
      'import { A } from "@/registry/bases/base/blocks/preview-02/cards/a"',
      'imports no card',
    ],
    [
      'a default import',
      `import Invoice from "${cards}/invoice"`,
      'preview preview/index.tsx: imports cards/invoice other than by name',
    ],
    [
      'a string-named import',
      `import { "invoice" as Invoice } from "${cards}/invoice"`,
      'imports cards/invoice other than by name',
    ],
    [
      'a path out of the block',
      `import { A } from "${cards}/../../x"`,
      'preview preview/index.tsx: card path cards/../../x is not kebab-case',
    ],
  ])('refuses %s', (_, source, message) => {
    expect(() => previewCards('preview', source)).toThrow(message)
  })
})

const prepared = (kept: string[], skipped: PreparedExample['skipped'] = []): PreparedExample => ({
  upstream: 'upstream copy',
  ours: `function ${kept[0]}() {}\nexport { ${kept.join(', ')} }\n`,
  kept,
  skipped,
})

const card = (block: string, name: string, component: string, result: PreparedExample) =>
  ({
    block,
    card: { file: `cards/${name}.tsx`, name, component },
    prepared: result,
  }) as ShowcaseCard

const showcase: ShowcaseCard[] = [
  card('preview', 'invoice', 'Invoice', prepared(['Invoice'])),
  card('preview', 'report-bug', 'ReportBug', prepared([], [{ name: 'ReportBug', reasons: ['x'] }])),
  // A card module that also exports a helper: only the index's function counts.
  card(
    'preview-02',
    'faq',
    'Faq',
    prepared(['FaqItem'], [{ name: 'Faq', reasons: ['needs menu', 'passes border-b'] }]),
  ),
  card('preview-02', 'payments', 'Payments', prepared(['Payments'])),
]

describe('skippedCards', () => {
  it('records why each card the showcase leaves out is left out, by block', () => {
    expect(skippedCards(showcase)).toEqual({
      preview: { 'report-bug': ['x'] },
      'preview-02': { faq: ['needs menu', 'passes border-b'] },
    })
  })

  it('records nothing when every card renders', () => {
    expect(skippedCards([showcase[0] as ShowcaseCard])).toEqual({})
  })

  // An `export const` card, say: preparation takes another export instead.
  it('refuses a card whose function preparation neither kept nor skipped', () => {
    const lost = card(
      'preview',
      'invoice',
      'Invoice',
      prepared(['Helper'], [{ name: 'Other', reasons: ['x'] }]),
    )
    expect(() => skippedCards([lost])).toThrow(
      'showcase preview/invoice: Invoice is not one of its sub-examples (Helper, Other)',
    )
  })
})

const config = forStyle(
  parseConfig({
    namespace: 'bje',
    upstream: {
      url: 'https://example.com/{style}/{name}.json',
      colorsUrl: 'https://example.com/colors/{name}.json',
      styles: ['base-vega', 'base-luma'],
    },
    theme: { baseColor: 'neutral', font: 'inter', iconLibrary: 'lucide' },
    components: ['card'],
    typeset: {
      stylesheet: 'https://example.com/typeset.css',
      fixturesUrl: 'https://example.com/fixtures/{name}.ts',
      fixtures: [],
    },
    preview: { url: 'https://example.com/{block}/{file}', blocks: ['preview-02', 'preview'] },
    snapshotDir: 'upstream',
    outputDir: 'registry/{style}/ui',
    hooksDir: 'registry/{style}/hooks',
    globalsDir: 'registry/{style}/styles',
    harnessDir: 'ab/generated/{style}',
    registryFile: 'registry/{style}/registry.json',
  }),
  'base-luma',
)

describe('showcaseIndex', () => {
  it("points the index's card imports at the block's wrappers, and keeps the rest as written", () => {
    const source = `"use client"\n\nimport * as React from "react"\nimport { Invoice } from "${cards}/invoice"\nimport { UIElements as UI } from "${cards}/ui-elements"\n\nexport default function PreviewExample() {\n  return <div className="grid"><Invoice /><UI /></div>\n}\n`
    expect(showcaseIndex('preview', source)).toBe(
      `"use client"\n\nimport * as React from "react"\nimport { Invoice } from "./cards"\nimport { UIElements as UI } from "./cards"\n\nexport default function PreviewExample() {\n  return <div className="grid"><Invoice /><UI /></div>\n}\n`,
    )
  })

  it('refuses an index that imports another registry module', () => {
    expect(() => showcaseIndex('preview', index)).toThrow(
      'preview preview/index.tsx: imports @/registry/bases/base/ui/button, which is not one of its cards',
    )
  })
})

const indexes = {
  preview: `import { Invoice } from "${cards}/invoice"\nexport default function PreviewExample() { return <Invoice /> }\n`,
  'preview-02': `import { Payments } from "@/registry/bases/base/blocks/preview-02/cards/payments"\nexport default function Preview02Example() { return <Payments /> }\n`,
}

describe('showcaseFiles', () => {
  const files = showcaseFiles(
    config,
    { cards: showcase, indexes, layoutCss: '/* layout */', fontTitle: 'Inter' },
    '// header',
  )
  const byPath = Object.fromEntries(files.map((file) => [file.path, file.content]))

  it("writes our copy of each card that renders, with the style's showcase inputs", () => {
    expect(Object.keys(byPath)).toEqual([
      'ab/generated/luma/showcase/preview/cards/invoice.tsx',
      'ab/generated/luma/showcase/preview-02/cards/payments.tsx',
      'ab/generated/luma/showcase/preview-02/index.tsx',
      'ab/generated/luma/showcase/preview-02/cards.tsx',
      'ab/generated/luma/showcase/preview/index.tsx',
      'ab/generated/luma/showcase/preview/cards.tsx',
      'ab/generated/luma/showcase.ts',
      'ab/generated/luma/showcase-theme.ts',
      'ab/generated/luma/showcase.css',
    ])
    expect(byPath['ab/generated/luma/showcase/preview/cards/invoice.tsx']).toBe(
      '// header\n\nfunction Invoice() {}\nexport { Invoice }\n',
    )
  })

  it("writes each block's index with its imports pointed at the block's wrappers", () => {
    expect(byPath['ab/generated/luma/showcase/preview-02/index.tsx']).toBe(
      '// header\n\nimport { Payments } from "./cards"\nexport default function Preview02Example() { return <Payments /> }\n',
    )
  })

  it('wraps each card the block imports, and renders nothing for a skipped one', () => {
    expect(byPath['ab/generated/luma/showcase/preview/cards.tsx']).toBe(`// header

import { CaseBoundary } from "../../../../case-boundary"
import { Invoice as PreparedInvoice } from "./cards/invoice"

export function Invoice() {
  return (
    <div data-card="invoice" style={{ display: 'contents' }}>
      <CaseBoundary>
        <PreparedInvoice />
      </CaseBoundary>
    </div>
  )
}

export function ReportBug() {
  return null
}
`)
  })

  it('lists each block with its index, in the order the config lists them', () => {
    expect(byPath['ab/generated/luma/showcase.ts']).toBe(`// header

import preview02 from "./showcase/preview-02/index"
import preview from "./showcase/preview/index"

export const style = "luma"
export const allStyles = ["vega","luma"]

export const blocks = [
  { name: "preview-02", Index: preview02 },
  { name: "preview", Index: preview },
]
`)
  })

  it('refuses a block with no index', () => {
    expect(() =>
      showcaseFiles(
        config,
        { cards: [], indexes: {}, layoutCss: '', fontTitle: 'Inter' },
        '// header',
      ),
    ).toThrow('showcase: no index for preview-02')
  })

  it("gives the /create stubs the style and the configured theme, as /create's lists name them", () => {
    expect(byPath['ab/generated/luma/showcase-theme.ts']).toBe(`// header

export const designSystem = {"style":"luma","baseColor":"neutral","font":"inter","fontHeading":"inter","iconLibrary":"lucide"}
export const fonts = [{"name":"Inter","value":"inter"}]
export const styles = [{"name":"luma","title":"Luma"}]
`)
  })

  it("adds the style's variant and the heading font class to the cards' layout CSS", () => {
    const css = byPath['ab/generated/luma/showcase.css'] as string
    expect(css.startsWith('/* layout */\n')).toBe(true)
    expect(css).toContain('@custom-variant style-luma (&:where(.style-luma *));')
    expect(css).not.toContain('style-vega')
    expect(css).toContain('.cn-font-heading {\n  font-family: var(--font-heading);\n}')
  })
})
