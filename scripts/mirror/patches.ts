// Deliberate changes to upstream's source, by item: each entry says why, and
// may rewrite the source (after the CLI's install transforms, before the
// conversion, so slots and generated tests see the patched code) and add test
// lines that pin the behaviour it is for. A transform that no longer finds
// what it changes, or no longer changes the source, fails the build naming
// the item, so a patch upstream has absorbed is noticed on the next sync.

import type { FunctionDeclaration, JSXAttribute, JSXOpeningElement, Node } from '@babel/types'
import MagicString from 'magic-string'
import { childNodes, parseModule } from './ast.ts'

export type Patch = {
  // One line, added to the header of the generated test, and of the
  // component file when there is a transform
  reason: string
  transform?: (source: string) => string
  // Lines appended to the item's generated test
  tests?: string[]
}

export type Patches = Readonly<Record<string, Patch>>

// Every node of a module, depth first.
function nodes(source: string): Node[] {
  const all: Node[] = []
  const visit = (node: Node) => {
    all.push(node)
    for (const child of childNodes(node)) visit(child)
  }
  visit(parseModule(source).program)
  return all
}

function openingElements(source: string): JSXOpeningElement[] {
  return nodes(source).filter(
    (node): node is JSXOpeningElement => node.type === 'JSXOpeningElement',
  )
}

function attribute(element: JSXOpeningElement, name: string): JSXAttribute | undefined {
  return element.attributes.find(
    (a): a is JSXAttribute => a.type === 'JSXAttribute' && a.name.name === name,
  )
}

function found<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`patches.ts: upstream's source has no ${what}`)
  return value
}

// Drops the named attributes from the one element carrying
// data-slot="<slot>". Each must be there, so a slot upstream renamed, or an
// attribute it dropped itself, fails the build by name.
export function dropAttributes(source: string, slot: string, names: string[]): string {
  const matches = openingElements(source).filter((element) => {
    const value = attribute(element, 'data-slot')?.value
    return value?.type === 'StringLiteral' && value.value === slot
  })
  const element = found(
    matches.length === 1 ? matches[0] : undefined,
    `single element with data-slot="${slot}"`,
  )
  const before = [element.name, ...element.attributes]
  const out = new MagicString(source)
  for (const name of names) {
    const a = found(attribute(element, name), `${name} on ${slot}`)
    const i = element.attributes.indexOf(a)
    out.remove((before[i] as Node).end as number, a.end as number)
  }
  return out.toString()
}

const THUMB_LABELS = ['getAriaLabel', 'getAriaValueText']

// Slider takes the thumb label props and passes them to every Thumb, where
// Base UI reads them.
export function forwardThumbLabels(source: string): string {
  const all = nodes(source)
  const thumb = found(
    openingElements(source).find(
      (e) => e.name.type === 'JSXMemberExpression' && e.name.property.name === 'Thumb',
    ),
    'Slider Thumb element',
  )
  // If upstream forwards both, return the source unchanged, so applyPatch
  // reports the patch as absorbed. One alone is a change to look at.
  const forwarded = THUMB_LABELS.filter((name) => attribute(thumb, name))
  if (forwarded.length === THUMB_LABELS.length) return source
  if (forwarded.length > 0) {
    throw new Error(`patches.ts: upstream's Slider Thumb forwards only ${forwarded.join(', ')}`)
  }
  const slider = found(
    all.find(
      (n): n is FunctionDeclaration => n.type === 'FunctionDeclaration' && n.id?.name === 'Slider',
    ),
    'Slider function',
  )
  const [param] = slider.params
  const props = found(param?.type === 'ObjectPattern' ? param : undefined, 'Slider props pattern')
  const rest = found(
    props.properties.find((p) => p.type === 'RestElement'),
    'rest element in the Slider props',
  )
  const type = found(
    props.typeAnnotation?.type === 'TSTypeAnnotation' ? props.typeAnnotation : undefined,
    'Slider props type',
  )
  const out = new MagicString(source)
  const primitive = source.slice(thumb.name.start as number, thumb.name.end as number)
  out.appendLeft(rest.start as number, THUMB_LABELS.map((name) => `${name}, `).join(''))
  out.appendLeft(
    type.typeAnnotation.end as number,
    ` & Pick<${primitive}.Props, ${THUMB_LABELS.map((name) => `'${name}'`).join(' | ')}>`,
  )
  out.appendLeft(
    thumb.name.end as number,
    THUMB_LABELS.map((name) => ` ${name}={${name}}`).join(''),
  )
  return out.toString()
}

export const PATCHES: Patches = {
  breadcrumb: {
    reason:
      'The WAI-ARIA APG breadcrumb pattern marks the current page as a link with aria-current="page" or as plain text; a span that navigates nowhere carries no link role.',
    transform: (source) => dropAttributes(source, 'breadcrumb-page', ['role', 'aria-disabled']),
    tests: [
      'describe("BreadcrumbPage, as patched", () => {',
      '  it("marks the current page with aria-current and no role", () => {',
      '    cleanup()',
      '    render(<BreadcrumbPage data-subject>Page</BreadcrumbPage>)',
      '    const page = document.querySelector("[data-subject]")',
      '    expect(page?.getAttribute("aria-current")).toBe("page")',
      '    expect(page?.hasAttribute("role")).toBe(false)',
      '    expect(page?.hasAttribute("aria-disabled")).toBe(false)',
      '  })',
      '})',
    ],
  },
  slider: {
    reason:
      'Base UI reads getAriaLabel and getAriaValueText on each Thumb, not the Root, so Slider takes both and passes them on: a range slider can name each thumb.',
    transform: forwardThumbLabels,
    tests: [
      'describe("Slider, as patched", () => {',
      '  it("names each thumb with getAriaLabel and getAriaValueText", () => {',
      '    cleanup()',
      '    render(',
      '      <Slider',
      '        defaultValue={[20, 60]}',
      '        getAriaLabel={(index) => (index === 0 ? "Minimum" : "Maximum")}',
      '        getAriaValueText={(formatted) => ["value", formatted].join(" ")}',
      '      />,',
      '    )',
      '    const inputs = [...document.querySelectorAll(\'[data-slot="slider-thumb"] input\')]',
      '    expect(inputs.map((input) => input.getAttribute("aria-label"))).toEqual(["Minimum", "Maximum"])',
      '    expect(inputs.map((input) => input.getAttribute("aria-valuetext"))).toEqual([',
      '      "value 20",',
      '      "value 60",',
      '    ])',
      '  })',
      '})',
    ],
  },
  alert: {
    reason:
      'A consumer\'s role replaces Alert\'s role="alert", so a status message can take role="status" and be announced politely.',
    tests: [
      'describe("Alert, with a consumer role", () => {',
      '  it("renders the consumer\'s role=\\"status\\" in place of role=\\"alert\\"", () => {',
      '    cleanup()',
      '    render(<Alert>Saved</Alert>)',
      '    expect(document.querySelector(\'[data-slot="alert"]\')?.getAttribute("role")).toBe("alert")',
      '    cleanup()',
      '    render(<Alert role="status">Saved</Alert>)',
      '    expect(document.querySelector(\'[data-slot="alert"]\')?.getAttribute("role")).toBe("status")',
      '  })',
      '})',
    ],
  },
  button: {
    reason:
      'Base UI gives a Button rendered as a link role="button"; a consumer\'s role="link" replaces it, so the link is announced as one.',
    tests: [
      'describe("Button, rendered as a link", () => {',
      '  it("takes the consumer\'s role=\\"link\\" over Base UI\'s role=\\"button\\"", () => {',
      '    cleanup()',
      '    render(<Button nativeButton={false} render={<a href="/docs">Docs</a>} />)',
      '    expect(document.querySelector(\'[data-slot="button"]\')?.getAttribute("role")).toBe("button")',
      '    cleanup()',
      '    render(<Button nativeButton={false} role="link" render={<a href="/docs">Docs</a>} />)',
      '    const link = document.querySelector(\'[data-slot="button"]\')',
      '    expect(link?.tagName).toBe("A")',
      '    expect(link?.getAttribute("role")).toBe("link")',
      '  })',
      '})',
    ],
  },
}

// The item's source with its patch applied, and the patch, if it has one.
export function applyPatch(
  name: string,
  source: string,
  patches: Patches = PATCHES,
): { source: string; patch?: Patch } {
  const patch = patches[name]
  if (!patch) return { source }
  if (!patch.transform) return { source, patch }
  let patched: string
  try {
    patched = patch.transform(source)
  } catch (error) {
    throw new Error(
      `${name}: its patch in scripts/mirror/patches.ts failed: ${(error as Error).message}`,
    )
  }
  if (patched === source) {
    throw new Error(
      `${name}: its patch in scripts/mirror/patches.ts changes nothing; upstream may have absorbed it (${patch.reason})`,
    )
  }
  return { source: patched, patch }
}
