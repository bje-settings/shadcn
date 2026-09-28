// Tailwind's internal custom properties (--tw-*) compose one CSS property from
// several utilities: a shadow and a focus ring share one box-shadow, a
// translate and a scale one transform, the animate-in utilities one keyframes
// pair. Upstream registers them globally with @property. Here they lose the
// tw- prefix and each module declares defaults for the ones it uses (scss.ts),
// so a consumer's global stylesheets hold only tokens.

// Families whose bare names collide with a variable a component sets itself:
// Drawer and Toast position their stacked popups with --translate-x/-y.
const FAMILIES: [from: string, to: string][] = [['translate-', 'transform-translate-']]

const INTERNAL = /--tw-([\w-]+)/g

export function internalName(name: string): string {
  const bare = name.slice('--tw-'.length)
  const family = FAMILIES.find(([from]) => bare.startsWith(from))
  return `--${family ? family[1] + bare.slice(family[0].length) : bare}`
}

export function renameInternal(text: string): string {
  return text.replace(INTERNAL, (name) => internalName(name))
}

// A renamed internal variable must not share a name with anything else a
// consumer's page sets: a theme token, or a component's own variable.
export function checkCollisions(internal: Set<string>, others: Set<string>): void {
  const clashes = [...internal].filter((name) => others.has(name)).sort()
  if (clashes.length > 0) {
    throw new Error(
      `internal custom properties collide with other variables: ${clashes.join(' ')}; add a family rename in scripts/mirror/internal.ts`,
    )
  }
}
