import { describe, expect, it } from 'vitest'
import { fixtureHtml } from './typeset.ts'

describe('fixtureHtml', () => {
  it('reads every *_HTML export, numbering them when there are several', () => {
    const source = `import { x } from "y"
export const CHAT_QUESTION = "not html"
export const CHAT_HTML = \`<p>one</p>\`
export const SECOND_HTML = "<p>two</p>"
export function helper() {}
export { x }`
    expect(fixtureHtml('chat', source)).toEqual([
      { name: 'chat-1', html: '<p>one</p>' },
      { name: 'chat-2', html: '<p>two</p>' },
    ])
  })

  it('names a single fixture after its file', () => {
    expect(
      fixtureHtml('docs', 'export const { A_HTML } = x\nexport const DOCS_HTML = `<h1>Docs</h1>`'),
    ).toEqual([{ name: 'docs', html: '<h1>Docs</h1>' }])
  })

  it.each([
    // biome-ignore lint/suspicious/noTemplateCurlyInString: source text with an interpolation, on purpose
    ['an interpolated fixture', 'export const A_HTML = `${x}`', 'A_HTML is not a plain string'],
    ['a computed fixture', 'export const A_HTML = build()', 'A_HTML is not a plain string'],
    ['a file without fixtures', 'export const A = 1', 'no *_HTML export'],
  ])('rejects %s', (_, source, message) => {
    expect(() => fixtureHtml('x', source)).toThrow(`typeset fixture x: ${message}`)
  })
})
