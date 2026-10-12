// shadcn's /create page previews blocks: an index that lays out a grid of
// cards, each card a module of its own that imports upstream's base
// components. `mirror fetch` snapshots each configured block's index and every
// card it imports; `mirror build` prepares the cards with each style's
// components, and the showcase page (ab/showcase.tsx) renders each index as
// upstream wrote it, with those cards.

import { dirname, relative } from 'node:path/posix'
import type { Node } from '@babel/types'
import MagicString from 'magic-string'
import { childNodes, parseModule, span } from './ast.ts'
import { type MirrorConfig, shortStyle } from './config.ts'
import type { PreparedExample } from './examples.ts'
import { camelCase, pascalCase } from './names.ts'

// The registry path the cards import components from: upstream's base
// components, the same for every style.
export const CARD_REGISTRY = 'bases/base'

export type PreviewCard = {
  // Its file in the block, cards/<name>.tsx
  file: string
  name: string
  // The function the index renders
  component: string
}

const SEGMENTS = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/

// The cards a block's index imports, in the order its markup first renders
// them. Fetched upstream source names files the fetch writes, so a path that
// is not plain kebab-case segments fails rather than escaping the snapshot.
export function previewCards(block: string, index: string): PreviewCard[] {
  const prefix = `@/registry/${CARD_REGISTRY}/blocks/${block}/`
  const where = `preview ${block}/index.tsx`
  const cards = new Map<string, PreviewCard>()
  const ast = parseModule(index)
  for (const statement of ast.program.body) {
    if (statement.type !== 'ImportDeclaration') continue
    const from = statement.source.value
    if (!from.startsWith(prefix)) continue
    const path = from.slice(prefix.length)
    if (!SEGMENTS.test(path)) throw new Error(`${where}: card path ${path} is not kebab-case`)
    for (const specifier of statement.specifiers) {
      if (specifier.type !== 'ImportSpecifier' || specifier.imported.type !== 'Identifier') {
        throw new Error(`${where}: imports ${path} other than by name`)
      }
      cards.set(specifier.local.name, {
        file: `${path}.tsx`,
        name: path.split('/').at(-1) as string,
        component: specifier.imported.name,
      })
    }
  }
  if (cards.size === 0) throw new Error(`${where}: imports no card from ${prefix}`)
  const rendered: string[] = []
  const visit = (node: Node) => {
    if (node.type === 'JSXIdentifier' && cards.has(node.name)) rendered.push(node.name)
    for (const child of childNodes(node)) visit(child)
  }
  visit(ast.program)
  return [...new Set([...rendered, ...cards.keys()])].map(
    (local) => cards.get(local) as PreviewCard,
  )
}

export type ShowcaseCard = { block: string; card: PreviewCard; prepared: PreparedExample }

export type ShowcaseInput = {
  cards: ShowcaseCard[]
  // Each block's snapshotted index, by block
  indexes: Record<string, string>
  // The cards' and the indexes' layout CSS (layoutCss over ./showcase)
  layoutCss: string
  // The theme font's title (Inter), as /create's font list names it
  fontTitle: string
}

// Whether the card's function survived preparation.
function kept({ card, prepared }: ShowcaseCard): boolean {
  return prepared.kept.includes(card.component)
}

// Why each card the showcase leaves out is left out, by block and card. A card
// whose function preparation neither kept nor skipped (one it did not take
// for a sub-example) fails, rather than leaving the page with no record.
export function skippedCards(cards: ShowcaseCard[]): Record<string, Record<string, string[]>> {
  const skipped: Record<string, Record<string, string[]>> = {}
  for (const showcaseCard of cards) {
    if (kept(showcaseCard)) continue
    const { block, card, prepared } = showcaseCard
    const reasons = prepared.skipped.find(({ name }) => name === card.component)?.reasons
    if (reasons === undefined) {
      throw new Error(
        `showcase ${block}/${card.name}: ${card.component} is not one of its sub-examples (${[...prepared.kept, ...prepared.skipped.map(({ name }) => name)].join(', ')})`,
      )
    }
    skipped[block] = { ...skipped[block], [card.name]: reasons }
  }
  return skipped
}

// A block's index as the showcase renders it: upstream's grid as written,
// its cards imported from the block's ./cards wrappers. An index importing any
// other registry module fails, rather than reaching upstream's components.
export function showcaseIndex(block: string, index: string): string {
  const prefix = `@/registry/${CARD_REGISTRY}/blocks/${block}/`
  const out = new MagicString(index)
  for (const statement of parseModule(index).program.body) {
    if (statement.type !== 'ImportDeclaration') continue
    const from = statement.source.value
    if (from.startsWith(prefix)) {
      out.overwrite(...span(statement.source), '"./cards"')
    } else if (from.startsWith('@/registry/')) {
      throw new Error(`preview ${block}/index.tsx: imports ${from}, which is not one of its cards`)
    }
  }
  return out.toString()
}

// A block's ./cards module: each card the index imports, under the name it
// imports it by, marked with its name (data-card) and wrapped in a
// CaseBoundary, so a card that throws fails alone. display: contents keeps
// the card itself the child of upstream's column. A card the style skips
// renders nothing.
function cardWrappers(path: string, cards: ShowcaseCard[]): string {
  const boundary = relative(dirname(path), 'ab/case-boundary')
  return [
    `import { CaseBoundary } from ${JSON.stringify(boundary)}`,
    ...cards
      .filter(kept)
      .map(
        ({ card }) =>
          `import { ${card.component} as Prepared${card.component} } from ${JSON.stringify(`./${card.file.replace(/\.tsx$/, '')}`)}`,
      ),
    ...cards.map((c) => {
      const { component, name } = c.card
      const body = kept(c)
        ? [
            '  return (',
            `    <div data-card=${JSON.stringify(name)} style={{ display: 'contents' }}>`,
            '      <CaseBoundary>',
            `        <Prepared${component} />`,
            '      </CaseBoundary>',
            '    </div>',
            '  )',
          ]
        : ['  return null']
      return ['', `export function ${component}() {`, ...body, '}'].join('\n')
    }),
  ].join('\n')
}

// The showcase page's generated inputs: each kept card (our copy), each
// block's index and card wrappers, the blocks in the config's order, every
// style the config builds, the design system the /create stubs return, and
// the layout CSS of the cards and the indexes.
export function showcaseFiles(
  config: MirrorConfig,
  showcase: ShowcaseInput,
  header: string,
): { path: string; content: string }[] {
  const dir = config.harnessDir
  const short = shortStyle(config.upstream.style)
  const cards = showcase.cards.filter(kept)
  const ts = (content: string) => `${header}\n\n${content}\n`
  const { blocks } = config.preview
  const index = (block: string) => {
    const source = showcase.indexes[block]
    if (source === undefined) throw new Error(`showcase: no index for ${block}`)
    return showcaseIndex(block, source)
  }
  const wrappers = (block: string) => `${dir}/showcase/${block}/cards.tsx`
  const { theme } = config
  const designSystem = {
    style: short,
    baseColor: theme.baseColor,
    font: theme.font,
    // The theme has no heading font: variables.scss sets --font-heading to the sans font.
    fontHeading: theme.font,
    iconLibrary: theme.iconLibrary,
  }
  return [
    ...cards.map(({ block, card, prepared }) => ({
      path: `${dir}/showcase/${block}/${card.file}`,
      content: `${header}\n\n${prepared.ours}`,
    })),
    ...blocks.flatMap((block) => [
      { path: `${dir}/showcase/${block}/index.tsx`, content: `${header}\n\n${index(block)}` },
      {
        path: wrappers(block),
        content: ts(
          cardWrappers(
            wrappers(block),
            showcase.cards.filter((c) => c.block === block),
          ),
        ),
      },
    ]),
    {
      path: `${dir}/showcase.ts`,
      content: ts(
        [
          ...blocks.map(
            (block) =>
              `import ${camelCase(block)} from ${JSON.stringify(`./showcase/${block}/index`)}`,
          ),
          '',
          `export const style = ${JSON.stringify(short)}`,
          '',
          'export const blocks = [',
          ...blocks.map(
            (block) => `  { name: ${JSON.stringify(block)}, Index: ${camelCase(block)} },`,
          ),
          ']',
        ].join('\n'),
      ),
    },
    // Every style the config builds, for the header's style select and the
    // root page's cards, in a module of its own so the root page imports no
    // showcase block.
    {
      path: `${dir}/styles.ts`,
      content: ts(
        `export const allStyles = ${JSON.stringify(config.upstream.styles.map(shortStyle))}`,
      ),
    },
    {
      path: `${dir}/showcase-theme.ts`,
      content: ts(
        [
          `export const designSystem = ${JSON.stringify(designSystem)}`,
          `export const fonts = ${JSON.stringify([{ name: showcase.fontTitle, value: theme.font }])}`,
          `export const styles = ${JSON.stringify([{ name: short, title: pascalCase(short) }])}`,
        ].join('\n'),
      ),
    },
    {
      path: `${dir}/showcase.css`,
      content: [
        showcase.layoutCss,
        // The cards adjust per style under a style-<name> ancestor, and set
        // headings in the heading font, as /create's own stylesheet defines.
        `@custom-variant style-${short} (&:where(.style-${short} *));`,
        '',
        '.cn-font-heading {',
        '  font-family: var(--font-heading);',
        '}',
        '',
      ].join('\n'),
    },
  ]
}
