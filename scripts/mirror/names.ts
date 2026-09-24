// Name conversions between upstream's kebab-case item and slot names and the
// PascalCase files and camelCase module classes the mirror generates.

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
