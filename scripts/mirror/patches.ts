// Deliberate changes to upstream's source, by item: each entry says why, and
// may rewrite the source (after the CLI's install transforms, before the
// conversion, so slots and generated tests see the patched code) and add test
// lines that pin the behaviour it is for. A transform that no longer finds
// what it changes, or no longer changes the source, fails the build naming
// the item, so a patch upstream has absorbed is noticed on the next sync.

import type {
  FunctionDeclaration,
  JSXAttribute,
  JSXOpeningElement,
  Node,
  ObjectProperty,
  VariableDeclaration,
} from '@babel/types'
import MagicString from 'magic-string'
import { childNodes, parseModule } from './ast.ts'

export type Patch = {
  // One line, added to the header of the generated test, and of the
  // component file when there is a transform
  reason: string
  transform?: (source: string) => string
  // Lines added to the item's generated test, after the component tests
  tests?: string[]
}

export type Patches = Readonly<Record<string, Patch>>

// A node and every node under it, depth first.
function descendants(root: Node): Node[] {
  const all: Node[] = []
  const visit = (node: Node) => {
    all.push(node)
    for (const child of childNodes(node)) visit(child)
  }
  visit(root)
  return all
}

// Every node of a module, depth first.
function nodes(source: string): Node[] {
  return descendants(parseModule(source).program)
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

// The one element carrying data-slot="<slot>", or undefined for none or more.
function slotted(elements: JSXOpeningElement[], slot: string): JSXOpeningElement | undefined {
  const matches = elements.filter((element) => {
    const value = attribute(element, 'data-slot')?.value
    return value?.type === 'StringLiteral' && value.value === slot
  })
  return matches.length === 1 ? matches[0] : undefined
}

function functionNamed(all: Node[], name: string): FunctionDeclaration | undefined {
  return all.find(
    (n): n is FunctionDeclaration => n.type === 'FunctionDeclaration' && n.id?.name === name,
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
  const element = found(
    slotted(openingElements(source), slot),
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

// What a suppression's locator returns: each site it names, with a node on
// the line the comment goes before (suppress puts it before the outermost
// node starting that line), or undefined when upstream's source lacks it.
export type Sites = Array<[what: string, node: Node | undefined]>

// Where the line holding a position starts.
function lineStart(source: string, at: number): number {
  return source.lastIndexOf('\n', at - 1) + 1
}

// Puts `biome-ignore <rule>: <reason>` on its own line before each node the
// locator names, at that line's indentation, since Biome applies it to the
// next line. A node after other code on its line (`<li key={index}>` after
// `error?.message && `) is suppressed from its ancestor that starts that line;
// one with none fails by name. The form is the position's: among JSX children
// `{/* */}`, as `//` there would be text; elsewhere (a statement, an object
// property, an attribute in an opening tag, a returned element) `//`. A
// named site that is gone fails the build by name; naming no site changes
// nothing, so applyPatch fails the build as absorbed.
export function suppress(
  source: string,
  rule: string,
  reason: string,
  locate: (all: Node[]) => Sites,
): string {
  const all = nodes(source)
  const parents = new Map<Node, Node>()
  for (const node of all) for (const child of childNodes(node)) parents.set(child, node)
  const out = new MagicString(source)
  for (const [what, located] of locate(all)) {
    let node = found(located, what)
    const line = lineStart(source, node.start as number)
    while (source.slice(line, node.start as number).trim() !== '') {
      // The program starts at 0, so every node has a parent until one starts
      // on an earlier line.
      node = parents.get(node) as Node
      if ((node.start as number) < line) {
        throw new Error(`patches.ts: ${what} does not start its line`)
      }
    }
    // The outermost node starting there takes the comment: an opening
    // element's element, an expression's statement.
    for (let up = parents.get(node); up !== undefined && up.start === node.start; ) {
      node = up
      up = parents.get(node)
    }
    const start = node.start as number
    const indent = source.slice(line, start)
    const parent = parents.get(node)?.type
    const comment = `biome-ignore ${rule}: ${reason}`
    out.appendLeft(
      start,
      parent === 'JSXElement' || parent === 'JSXFragment'
        ? `{/* ${comment} */}\n${indent}`
        : `// ${comment}\n${indent}`,
    )
  }
  return out.toString()
}

const CALENDAR_COMPONENTS = ['Root', 'Chevron', 'DayButton', 'WeekNumber']
const INLINE = ['ArrowFunctionExpression', 'FunctionExpression']

// The properties of the components object Calendar passes to DayPicker that
// upstream writes as `Name: () => ...` or `Name: function () {}`. Any other
// form (hoisted, a method, a quoted key) is a site gone, so the build fails
// by name instead of suppressing a rule it may no longer trip.
export function calendarComponents(all: Node[]): Sites {
  const calendar = found(
    all.find(
      (n): n is FunctionDeclaration =>
        n.type === 'FunctionDeclaration' && n.id?.name === 'Calendar',
    ),
    'Calendar function',
  )
  const dayPicker = found(
    descendants(calendar).find(
      (n): n is JSXOpeningElement =>
        n.type === 'JSXOpeningElement' &&
        n.name.type === 'JSXIdentifier' &&
        n.name.name === 'DayPicker',
    ),
    'DayPicker element in Calendar',
  )
  const value = attribute(dayPicker, 'components')?.value
  const object = found(
    value?.type === 'JSXExpressionContainer' && value.expression.type === 'ObjectExpression'
      ? value.expression
      : undefined,
    'components object on DayPicker',
  )
  return CALENDAR_COMPONENTS.map((name) => [
    `inline ${name} in DayPicker's components`,
    object.properties.find(
      (p): p is ObjectProperty =>
        p.type === 'ObjectProperty' &&
        !p.computed &&
        p.key.type === 'Identifier' &&
        p.key.name === name &&
        INLINE.includes(p.value.type),
    ),
  ])
}

// Each suppression an entry applies, in order: the rule, why, and where.
type Suppression = [rule: string, reason: string, locate: (all: Node[]) => Sites]

function suppressEach(source: string, suppressions: Suppression[]): string {
  return suppressions.reduce(
    (code, [rule, reason, locate]) => suppress(code, rule, reason, locate),
    source,
  )
}

// The one element carrying each data-slot, when it has the role given. Biome
// honours a useSemanticElements suppression before the element, not before
// its role attribute.
export function roles(slots: Record<string, string>): (all: Node[]) => Sites {
  return (all) => {
    const elements = all.filter((n): n is JSXOpeningElement => n.type === 'JSXOpeningElement')
    return Object.entries(slots).map(([slot, role]) => {
      const element = slotted(elements, slot)
      const value = element && attribute(element, 'role')?.value
      return [
        `single element with data-slot="${slot}" and role="${role}"`,
        value?.type === 'StringLiteral' && value.value === role ? element : undefined,
      ]
    })
  }
}

// The one element carrying data-slot="<slot>", for a rule Biome reports on
// the whole element.
export function slotElement(slot: string): (all: Node[]) => Sites {
  return (all) => [
    [
      `single element with data-slot="${slot}"`,
      slotted(
        all.filter((n): n is JSXOpeningElement => n.type === 'JSXOpeningElement'),
        slot,
      ),
    ],
  ]
}

// In each function named, the one key attribute set from a callback's index
// parameter: `.map((item, index) => <div key={index} />)`, or Array.from's.
export function indexKeys(...functions: string[]): (all: Node[]) => Sites {
  return (all) =>
    functions.map((name) => {
      const fn = all.find(
        (n) =>
          (n.type === 'FunctionDeclaration' && n.id?.name === name) ||
          (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.id.name === name),
      )
      const keys = (fn ? descendants(fn) : []).flatMap((n) =>
        n.type === 'CallExpression' ? n.arguments.flatMap(indexKeyed) : [],
      )
      return [`key from a callback's index in ${name}`, keys.length === 1 ? keys[0] : undefined]
    })
}

function indexKeyed(callback: Node): JSXAttribute[] {
  if (callback.type !== 'ArrowFunctionExpression' && callback.type !== 'FunctionExpression') {
    return []
  }
  const index = callback.params[1]
  if (index?.type !== 'Identifier') return []
  return descendants(callback).filter((n): n is JSXAttribute => {
    if (n.type !== 'JSXAttribute' || n.name.name !== 'key') return false
    const value = n.value
    return (
      value?.type === 'JSXExpressionContainer' &&
      value.expression.type === 'Identifier' &&
      value.expression.name === index.name
    )
  })
}

// The one attribute of that name on an element with that tag.
export function tagAttribute(tag: string, name: string): (all: Node[]) => Sites {
  return (all) => {
    const matches = all.flatMap((n) =>
      n.type === 'JSXOpeningElement' && n.name.type === 'JSXIdentifier' && n.name.name === tag
        ? [attribute(n, name)].filter((a) => a !== undefined)
        : [],
    )
    return [[`single ${name} on a ${tag} element`, matches.length === 1 ? matches[0] : undefined]]
  }
}

// In the function, each `const <name> = React.<hook>(..., [deps])` whose
// dependencies list the identifier given.
export function hookDependencies(
  fn: string,
  dependency: string,
  hooks: Record<string, string>,
): (all: Node[]) => Sites {
  return (all) => {
    const body = descendants(found(functionNamed(all, fn), `${fn} function`))
    return Object.entries(hooks).map(([name, hook]) => [
      `${name} = React.${hook}(...) listing ${dependency} in ${fn}`,
      body.find((n): n is VariableDeclaration => {
        if (n.type !== 'VariableDeclaration' || n.declarations.length !== 1) return false
        const [{ id, init }] = n.declarations as [VariableDeclaration['declarations'][number]]
        if (id.type !== 'Identifier' || id.name !== name || init?.type !== 'CallExpression') {
          return false
        }
        const { callee } = init
        const deps = init.arguments.at(-1)
        return (
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'React' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === hook &&
          deps?.type === 'ArrayExpression' &&
          deps.elements.some((e) => e?.type === 'Identifier' && e.name === dependency)
        )
      }),
    ])
  }
}

// In the function, the statement assigning document.cookie.
export function cookieWrite(fn: string): (all: Node[]) => Sites {
  return (all) => [
    [
      `document.cookie assignment in ${fn}`,
      descendants(found(functionNamed(all, fn), `${fn} function`)).find(
        (n) =>
          n.type === 'ExpressionStatement' &&
          n.expression.type === 'AssignmentExpression' &&
          n.expression.left.type === 'MemberExpression' &&
          !n.expression.left.computed &&
          n.expression.left.object.type === 'Identifier' &&
          n.expression.left.object.name === 'document' &&
          n.expression.left.property.type === 'Identifier' &&
          n.expression.left.property.name === 'cookie',
      ),
    ],
  ]
}

// The function's return statement that returns a <tag> element.
export function returnedElement(fn: string, tag: string): (all: Node[]) => Sites {
  return (all) => [
    [
      `return of a ${tag} element in ${fn}`,
      descendants(found(functionNamed(all, fn), `${fn} function`)).find((n) => {
        if (n.type !== 'ReturnStatement' || n.argument?.type !== 'JSXElement') return false
        const { name } = n.argument.openingElement
        return name.type === 'JSXIdentifier' && name.name === tag
      }),
    ],
  ]
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

const SEMANTIC = 'lint/a11y/useSemanticElements'
const INDEX_KEY = 'lint/suspicious/noArrayIndexKey'
const GROUP_REASON =
  'upstream\'s div carries role="group"; a fieldset would change the box and the form semantics'

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
      "Base UI reads getAriaLabel and getAriaValueText on each Thumb, not the Root, so Slider takes both and passes them on, and Biome's noArrayIndexKey is suppressed on the thumbs upstream keys by index.",
    // Once upstream forwards the labels, the source comes back unchanged, so
    // applyPatch reports the patch as absorbed.
    transform: (source) => {
      const forwarded = forwardThumbLabels(source)
      if (forwarded === source) return source
      return suppress(
        forwarded,
        INDEX_KEY,
        'upstream renders one thumb per value with Array.from, so the index is all a thumb has',
        indexKeys('Slider'),
      )
    },
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
  calendar: {
    reason:
      "Biome's noComponentHookFactories is suppressed on the render functions upstream passes inline to react-day-picker's components prop.",
    transform: (source) =>
      suppress(
        source,
        'lint/correctness/noComponentHookFactories',
        'upstream passes react-day-picker its components inline',
        calendarComponents,
      ),
  },
  'button-group': {
    reason: 'Biome\'s useSemanticElements is suppressed on the div upstream gives role="group".',
    transform: (source) =>
      suppress(source, SEMANTIC, GROUP_REASON, roles({ 'button-group': 'group' })),
  },
  carousel: {
    reason:
      'Biome\'s useSemanticElements is suppressed on the divs upstream gives role="region" and role="group".',
    transform: (source) =>
      suppress(
        source,
        SEMANTIC,
        'upstream\'s divs carry role="region" and role="group" with an aria-roledescription; a section or fieldset would change the box and the semantics',
        roles({ carousel: 'region', 'carousel-item': 'group' }),
      ),
  },
  field: {
    reason:
      'Biome\'s useSemanticElements and noArrayIndexKey are suppressed on the div Field gives role="group" and on the errors FieldError keys by index.',
    transform: (source) =>
      suppressEach(source, [
        [SEMANTIC, GROUP_REASON, roles({ field: 'group' })],
        [
          INDEX_KEY,
          'upstream keys each error by its index; the items hold no state, so a reorder only re-renders them',
          indexKeys('FieldError'),
        ],
      ]),
  },
  'input-group': {
    reason:
      'Biome\'s useSemanticElements and useKeyWithClickEvents are suppressed on the divs upstream gives role="group" and on the addon that focuses the input when clicked.',
    transform: (source) =>
      suppressEach(source, [
        [SEMANTIC, GROUP_REASON, roles({ 'input-group': 'group', 'input-group-addon': 'group' })],
        [
          'lint/a11y/useKeyWithClickEvents',
          'upstream focuses the input on an addon click; the input itself is keyboard reachable',
          slotElement('input-group-addon'),
        ],
      ]),
  },
  'input-otp': {
    reason:
      'Biome\'s useSemanticElements is suppressed on the div upstream gives role="separator".',
    transform: (source) =>
      suppress(
        source,
        SEMANTIC,
        'upstream\'s div carries role="separator" around an icon, which an hr cannot hold',
        roles({ 'input-otp-separator': 'separator' }),
      ),
  },
  item: {
    reason: 'Biome\'s useSemanticElements is suppressed on the div upstream gives role="list".',
    transform: (source) =>
      suppress(
        source,
        SEMANTIC,
        'upstream\'s div carries role="list"; a ul would bring list styles and need li children',
        roles({ 'item-group': 'list' }),
      ),
  },
  chart: {
    reason:
      "Biome's noDangerouslySetInnerHtml and noArrayIndexKey are suppressed on ChartStyle's style element and on the tooltip and legend items upstream keys by index.",
    transform: (source) =>
      suppressEach(source, [
        [
          'lint/security/noDangerouslySetInnerHtml',
          "upstream injects the chart's generated CSS variables as a style element",
          tagAttribute('style', 'dangerouslySetInnerHTML'),
        ],
        [
          INDEX_KEY,
          'upstream keys each payload item by its index; the items hold no state, so a reorder only re-renders them',
          indexKeys('ChartTooltipContent', 'ChartLegendContent'),
        ],
      ]),
  },
  sidebar: {
    reason:
      "Biome's useExhaustiveDependencies and noDocumentCookie are suppressed on SidebarProvider's hooks that list setOpenMobile and on its cookie write.",
    transform: (source) =>
      suppressEach(source, [
        [
          'lint/correctness/useExhaustiveDependencies',
          'upstream lists setOpenMobile, a stable setter, in the dependencies',
          hookDependencies('SidebarProvider', 'setOpenMobile', {
            toggleSidebar: 'useCallback',
            contextValue: 'useMemo',
          }),
        ],
        [
          'lint/suspicious/noDocumentCookie',
          'upstream persists the sidebar state in a cookie by assignment',
          cookieWrite('SidebarProvider'),
        ],
      ]),
  },
  label: {
    reason: "Biome's noLabelWithoutControl is suppressed on the native label Label renders.",
    transform: (source) =>
      suppress(
        source,
        'lint/a11y/noLabelWithoutControl',
        'Label wraps a native label; the consumer associates it with htmlFor or nesting',
        returnedElement('Label', 'label'),
      ),
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
      { cause: error },
    )
  }
  if (patched === source) {
    throw new Error(
      `${name}: its patch in scripts/mirror/patches.ts changes nothing; upstream may have absorbed it (${patch.reason})`,
    )
  }
  return { source: patched, patch }
}
