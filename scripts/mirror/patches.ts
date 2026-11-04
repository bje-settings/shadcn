// Deliberate changes to upstream's source, by item: each entry says why, and
// may rewrite the source (after the CLI's install transforms, before the
// conversion, so slots and generated tests see the patched code) and add test
// lines that pin the behaviour it is for. A transform that no longer changes
// the source fails the build, so a patch upstream has absorbed is noticed on
// the next sync.

export type Patch = {
  // One line, written into the header of each file the patch reaches
  reason: string
  transform?: (source: string) => string
  // Lines appended to the item's generated test
  tests?: string[]
}

export type Patches = Readonly<Record<string, Patch>>

export const PATCHES: Patches = {}

// The item's source with its patch applied, and the patch, if it has one.
export function applyPatch(
  name: string,
  source: string,
  patches: Patches = PATCHES,
): { source: string; patch?: Patch } {
  const patch = patches[name]
  if (!patch) return { source }
  if (!patch.transform) return { source, patch }
  const patched = patch.transform(source)
  if (patched === source) {
    throw new Error(
      `${name}: its patch in scripts/mirror/patches.ts changes nothing; upstream may have absorbed it (${patch.reason})`,
    )
  }
  return { source: patched, patch }
}
