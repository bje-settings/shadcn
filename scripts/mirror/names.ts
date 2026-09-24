// Name conversions between upstream's kebab-case item and slot names and the
// PascalCase files and camelCase module classes the mirror generates, and the
// module path of a mirrored item.

function words(name: string): string[] {
  return name.split(/[^a-zA-Z0-9]+/).filter(Boolean)
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

export function pascalCase(name: string): string {
  return words(name).map(capitalize).join('')
}

export function camelCase(name: string): string {
  const pascal = pascalCase(name)
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

// Where this registry's copy of an item lives, as its components and the A/B
// harness import it: a component in its PascalCase folder, a hook by name.
export function registryModule(
  namespace: string,
  item: string,
  kind: 'ui' | 'hooks' = 'ui',
): string {
  if (kind === 'hooks') return `@/registry/${namespace}/hooks/${item}`
  const file = pascalCase(item)
  return `@/registry/${namespace}/ui/${file}/${file}`
}
