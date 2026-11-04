// A derived style's hand-written layer: registry/<style>/overrides/, beside
// the output it changes. The build never writes there. After it builds the
// style, it layers the overrides onto the output: a stylesheet whose path
// matches a generated one is appended to it, and the files of each item
// overrides.json declares are copied into the style's directory and
// published. Generated files stay generated: an appended one says so in its
// header, and nothing edits one in place.

import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { ITEM_TYPES, type ItemType, type RegistryItem } from './component.ts'
import type { MirrorConfig } from './config.ts'
import { KEBAB, Shape } from './parse.ts'

// What overrides.json declares: the items the style adds, and the
// registryDependencies each item (generated or added) gains.
export type Manifest = {
  items: RegistryItem[]
  registryDependencies: Record<string, string[]>
}

export type Overrides = {
  // The overrides directory, relative to the repository root
  dir: string
  manifest: Manifest
  // Every other file, by its path relative to the directory
  files: Map<string, string>
}

export const MANIFEST = 'overrides.json'

// The style's directory: where its registry.json, ui/ and styles/ sit, and
// what an override's path is relative to.
export function styleDir(config: MirrorConfig): string {
  return dirname(config.registryFile)
}

export function overridesDir(config: MirrorConfig): string {
  return join(styleDir(config), 'overrides')
}

// Every file under the directory, sorted, or undefined when it does not exist.
// Hidden files and directories (a .DS_Store, an editor's) are not overrides.
export async function listFiles(root: string, dir: string): Promise<string[] | undefined> {
  try {
    const entries = await readdir(join(root, dir), { recursive: true, withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => relative(join(root, dir), join(entry.parentPath, entry.name)))
      .filter((path) => !path.split(sep).some((part) => part.startsWith('.')))
      .sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export function parseManifest(raw: unknown, where: string): Manifest {
  const shape: Shape = new Shape(where)
  const itemType = (value: unknown, path: string): ItemType => {
    const type = shape.string(value, path)
    if (!(ITEM_TYPES as readonly string[]).includes(type)) {
      shape.fail(`${path} must be one of ${ITEM_TYPES.join(', ')}`)
    }
    return type as ItemType
  }
  const manifest = shape.record(raw, 'manifest')
  const items = manifest.items
  if (!Array.isArray(items)) shape.fail('items must be an array')
  const parsed = items.map((value, i): RegistryItem => {
    const path = `items[${i}]`
    const item = shape.record(value, path)
    const name = shape.string(item.name, `${path}.name`)
    if (!KEBAB.test(name)) shape.fail(`${path}.name must be kebab-case`)
    if (!Array.isArray(item.files) || item.files.length === 0) {
      shape.fail(`${path}.files must be a non-empty array`)
    }
    return {
      name,
      type: itemType(item.type, `${path}.type`),
      title: shape.string(item.title, `${path}.title`),
      dependencies: shape.strings(item.dependencies, `${path}.dependencies`),
      devDependencies: shape.strings(item.devDependencies, `${path}.devDependencies`),
      registryDependencies: shape.strings(
        item.registryDependencies,
        `${path}.registryDependencies`,
      ),
      files: item.files.map((file: unknown, j) => {
        const at = `${path}.files[${j}]`
        const record = shape.record(file, at)
        const entry = {
          path: shape.string(record.path, `${at}.path`),
          type: itemType(record.type, `${at}.type`),
        }
        // shadcn places a registry:file by its target alone.
        if (record.target === undefined) {
          if (entry.type === 'registry:file')
            shape.fail(`${at}.target is required for registry:file`)
          return entry
        }
        return { ...entry, target: shape.string(record.target, `${at}.target`) }
      }),
    }
  })
  const names = parsed.map((item) => item.name)
  if (new Set(names).size !== names.length) shape.fail('items must not repeat a name')
  const paths = parsed.flatMap((item) => item.files.map((file) => file.path))
  if (new Set(paths).size !== paths.length) shape.fail('items must not repeat a file path')
  const dependencies = shape.record(manifest.registryDependencies, 'registryDependencies')
  const registryDependencies = Object.fromEntries(
    Object.entries(dependencies).map(([item, names]) => [
      item,
      shape.strings(names, `registryDependencies.${item}`),
    ]),
  )
  return { items: parsed, registryDependencies }
}

// The style's overrides, or undefined when it has no overrides directory.
export async function readOverrides(
  root: string,
  config: MirrorConfig,
): Promise<Overrides | undefined> {
  const dir = overridesDir(config)
  const paths = await listFiles(root, dir)
  if (paths === undefined) return undefined
  const files = new Map<string, string>()
  for (const path of paths) files.set(path, await readFile(join(root, dir, path), 'utf8'))
  const text = files.get(MANIFEST)
  files.delete(MANIFEST)
  const where = join(dir, MANIFEST)
  const manifest =
    text === undefined
      ? { items: [], registryDependencies: {} }
      : parseManifest(parseManifestJson(text, where), where)
  return { dir, manifest, files }
}

function parseManifestJson(text: string, where: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${where}: ${(error as Error).message}`)
  }
}

// The module classes a stylesheet names, outside comments and :global().
export function classesNamed(scss: string): Set<string> {
  const code = scss
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/:global\([^)]*\)/g, '')
  return new Set([...code.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((match) => match[1] as string))
}

// Whether a path is the directory or lies under it: relative() leaves no
// leading .. for either.
function holds(dir: string, path: string): boolean {
  return relative(dir, path).split(sep)[0] !== '..'
}

export type RuleSelector = {
  selector: string
  // Inside another style rule, where it compiles to a longer selector
  nested: boolean
  // Nested in exactly one style rule, with no at-rule between them
  direct: boolean
}

// The one nested rule an override may hold, directly inside a :where() rule:
// maia's own dark rules are scoped this way, (0,1,0), so a page-level
// control's dark tint can only win at the same rank (ruling 17). frost's
// NativeSelect needs it: maia gives that control a dark fill so scoped.
export const DARK_RULE = '&:is(:global(.dark) *)'

// The at-rules a style rule may sit in and keep its own selector.
const CONDITIONS = /^@(media|supports|container)\b/

// The selectors of a stylesheet's style rules, outside comments, each split
// at its commas: at the top level, inside at-rules (@media, @supports,
// @container) at any depth, and nested in other rules. A @keyframes block's
// steps are not selectors, and are left out. Any other block at-rule (@at-root,
// @include) emits rules whose selectors this cannot see, so its prelude is
// listed as a selector, which no check accepts.
export function ruleSelectors(scss: string): RuleSelector[] {
  const code = scss.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const selectors: RuleSelector[] = []
  const blocks: ('rule' | 'at' | 'keyframes')[] = []
  let start = 0
  for (let i = 0; i < code.length; i++) {
    const char = code[i]
    if (char === '{') {
      const prelude = code.slice(start, i).trim()
      if (prelude.startsWith('@') && /^@(-[a-z]+-)?keyframes\b/.test(prelude)) {
        blocks.push('keyframes')
      } else if (CONDITIONS.test(prelude)) {
        blocks.push('at')
      } else {
        if (!blocks.includes('keyframes')) {
          const nested = blocks.includes('rule')
          const direct =
            blocks.at(-1) === 'rule' && blocks.filter((block) => block === 'rule').length === 1
          for (const selector of splitList(prelude)) selectors.push({ selector, nested, direct })
        }
        blocks.push('rule')
      }
      start = i + 1
    } else if (char === '}') {
      blocks.pop()
      start = i + 1
    } else if (char === ';') {
      start = i + 1
    }
  }
  return selectors
}

// A selector list split at the commas outside parentheses.
function splitList(list: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < list.length; i++) {
    const char = list[i]
    if (char === '(') depth++
    else if (char === ')') depth--
    else if (char === ',' && depth === 0) {
      parts.push(list.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(list.slice(start).trim())
  return parts
}

// Whether a selector is one :where(), which adds no specificity.
function zeroSpecificity(selector: string): boolean {
  if (!selector.startsWith(':where(')) return false
  let depth = 0
  for (let i = ':where'.length; i < selector.length; i++) {
    if (selector[i] === '(') depth++
    else if (selector[i] === ')') depth--
    if (depth === 0) return i === selector.length - 1
  }
  return false
}

// A generated stylesheet with an override appended: its first line, the
// generated header, gains a second that names the override, so nobody takes
// the file for the base style's.
export function appendOverride(generated: string, override: string, source: string): string {
  const [header, ...rest] = generated.split('\n')
  return [
    header,
    `// Ends with ${source}, appended by scripts/mirror.`,
    ...rest,
    `// Appended from ${source}.`,
    '',
    override,
  ].join('\n')
}

export type Layered = {
  // Output files to write, by path relative to the repository root
  files: { path: string; content: string }[]
  // Directories to clear first: each added item's, so a file it dropped goes
  dirs: string[]
  // The catalog, with the added items and dependencies
  items: RegistryItem[]
}

// Layers the overrides onto a built style. `generated` reads a file the build
// just wrote, or undefined when it wrote none at that path.
export async function layerOverrides(
  overrides: Overrides,
  config: MirrorConfig,
  items: RegistryItem[],
  generated: (path: string) => Promise<string | undefined>,
): Promise<Layered> {
  const { dir, manifest } = overrides
  const style = styleDir(config)
  const where = join(dir, MANIFEST)
  const shape: Shape = new Shape(where)
  const files: Layered['files'] = []
  const declared = new Set<string>()
  const generatedNames = new Set(items.map((item) => item.name))
  const added = manifest.items.map((item, i) => {
    if (generatedNames.has(item.name)) {
      shape.fail(`items[${i}].name ${item.name} is a generated item`)
    }
    return {
      ...item,
      files: item.files.map((file, j) => {
        const content = overrides.files.get(file.path)
        if (content === undefined) {
          shape.fail(`items[${i}].files[${j}].path ${file.path} is not in ${dir}`)
        }
        declared.add(file.path)
        const path = join(style, file.path)
        files.push({ path, content })
        return { ...file, path }
      }),
    }
  })
  // Each added item's directories are its own: one that holds a generated
  // file, at any depth, would lose it when the build clears them. One above
  // the overrides holds every generated item; one at or under them is
  // refused below, with the files written there.
  const dirs = [...new Set(added.flatMap((item) => item.files.map((file) => dirname(file.path))))]
  for (const item of items) {
    for (const file of item.files) {
      const clash = dirs.find((dir) => holds(dir, file.path))
      if (clash !== undefined) shape.fail(`${clash} holds ${item.name}, a generated item`)
    }
  }

  for (const [path, override] of overrides.files) {
    if (declared.has(path)) continue
    const source = join(dir, path)
    if (!path.endsWith('.scss')) {
      throw new Error(
        `${source}: only a stylesheet (.scss) appends to a generated file; list any other in ${MANIFEST}`,
      )
    }
    const target = join(style, path)
    const content = await generated(target)
    if (content === undefined) {
      throw new Error(
        `${source}: no generated ${target} to append to, and no item in ${MANIFEST} lists it`,
      )
    }
    if (path.endsWith('.module.scss')) {
      const own = classesNamed(content)
      for (const name of classesNamed(override)) {
        if (!own.has(name)) throw new Error(`${source}: .${name} is not a class of ${target}`)
      }
      // Zero specificity, as the generated rules have, so a consumer's
      // className still wins. A nested rule compiles to its parent's
      // selector plus its own (&:hover to :where(.x):hover), which outranks it;
      // DARK_RULE alone, directly in a :where() rule, ranks with maia's own.
      for (const { selector, nested, direct } of ruleSelectors(override)) {
        if (nested && direct && selector === DARK_RULE) continue
        if (nested) {
          throw new Error(
            `${source}: ${selector} is nested in a rule; write it as its own :where()`,
          )
        }
        if (!zeroSpecificity(selector)) {
          throw new Error(`${source}: ${selector} is not wrapped in :where()`)
        }
      }
    }
    files.push({ path: target, content: appendOverride(content, override, source) })
  }
  // The build never writes the overrides, nor clears a directory among them.
  const inside = files.find((file) => holds(overridesDir(config), file.path))
  if (inside !== undefined) shape.fail(`${inside.path} is in ${overridesDir(config)}`)

  // Copies, so the caller's items are left as they were.
  const catalog = [...items, ...added].map((item) => ({
    ...item,
    registryDependencies: [...item.registryDependencies],
  }))
  const byName = new Map(catalog.map((item) => [item.name, item]))
  // An added item's own dependencies are published as written: each must
  // name an item of this style, in its namespace.
  const prefix = `@${config.namespace}/`
  manifest.items.forEach((item, i) => {
    item.registryDependencies.forEach((dependency, j) => {
      if (!dependency.startsWith(prefix) || !byName.has(dependency.slice(prefix.length))) {
        shape.fail(
          `items[${i}].registryDependencies[${j}] ${dependency} is not ${prefix}<an item of ${config.styleName}>`,
        )
      }
    })
  })
  for (const [name, dependencies] of Object.entries(manifest.registryDependencies)) {
    const item = byName.get(name)
    if (item === undefined) {
      shape.fail(`registryDependencies.${name} is not an item of ${config.styleName}`)
    }
    dependencies.forEach((dependency, i) => {
      if (!byName.has(dependency)) {
        shape.fail(
          `registryDependencies.${name}[${i}] ${dependency} is not an item of ${config.styleName}`,
        )
      }
      const qualified = `@${config.namespace}/${dependency}`
      if (!item.registryDependencies.includes(qualified)) item.registryDependencies.push(qualified)
    })
  }
  return { files, dirs, items: catalog }
}
