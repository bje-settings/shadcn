# Mirror pipeline

Components under `registry/<style>/ui/` are shadcn's own, with Tailwind utilities converted to SCSS
modules. Every upstream `registry:ui` item with content is mirrored, plus the `use-mobile` hook
Sidebar needs. Upstream's `form` item has no files, so there is nothing to mirror.
[mirror-config.md](mirror-config.md) covers what `mirror.config.json` sets.

```bash
pnpm mirror:fetch           # snapshot upstream into upstream/
pnpm mirror:build [style]   # convert the snapshots, for every style or one
```

`mirror:fetch` writes, per style, each configured item, its docs example (`<item>-example`) where
upstream has one, the style's index, the font and the base color to `upstream/base-<style>/`, and
Typeset's stylesheet and content fixtures to `upstream/typeset/`. A JSON snapshot whose shape the
build cannot read fails the fetch before it is written. `mirror:build` reads only the snapshots
(`scripts/mirror/cli.ts`), so a conversion change is reviewable without upstream moving underneath
it.

Each style is built whole and on its own: styles differ in their components' classes, not only in
variables (vega's Button is `rounded-md px-2.5`, luma's `rounded-4xl px-3`).

## Project CSS

The build first rebuilds the CSS entry file `shadcn init` writes for the style and theme
(`upstream/base-<style>/index.css`) from the snapshots. That file is the Tailwind input for every
conversion below and styles the A/B harness's upstream page.

## Components

For each component, the build:

1. Applies the shadcn CLI's own install transforms (`shadcn/utils`), so it converts what
   `shadcn add` writes into a project: `IconPlaceholder` becomes the configured icon library's
   icon, `cn-font-heading` becomes `font-heading`, and the menu hooks resolve. Any other `cn-*`
   style hook is dropped, as the CLI does.
2. Rewrites the TSX (`scripts/mirror/tsx.ts`): `cva()` becomes a lookup object plus a same-named
   function, `cn()` becomes `clsx()`, and class strings become `styles.<slot>` references named
   from `data-slot` (or Base UI `useRender`'s `state.slot`). An element without a `data-slot` is
   named from its component and tag (`accordionTriggerHeader`); each branch of a conditional class
   gets its own slot. An element without a `data-slot` whose own class names contain `size-` gets
   a `data-class-size` attribute, for step 3's probe. Imports of other upstream components point at
   this registry's copies, and each upstream `registryDependencies` entry becomes `@bje/<item>`; a
   dependency not listed in `mirror.config.json` fails the build.
3. Compiles each slot's classes with Tailwind itself against `upstream/base-<style>/index.css`
   (`scripts/mirror/scss.ts`):
   - Rules styling the slot's own element nest under `:where(.<slot>)`, so a consumer's
     `className` wins. Rules styling descendants (`*:w-full`, `& svg`) nest under `.<slot>`.
   - Selectors on Tailwind's `group`/`peer` marker classes target the `data-slot` of the mirrored
     elements that carry the marker, in any component (`group-data-[size=sm]/card:` becomes
     `&:is(:where([data-slot="card"])[data-size="sm"] *)`). A marker no mirrored element carries
     fails the build, unless the rule's own class is in `classesWithoutCss` because upstream's
     markup never carries the marker either; that rule is dropped and noted in the header.
   - Upstream's `svg:not([class*="size-"])` defaults keep the probe, so an element whose own class
     name contains `size-` keeps its size. They also skip the mirrored elements whose upstream
     classes contain it (Spinner, an icon with its own size class), matched by `data-slot` or by
     `data-class-size`. A probe that matches no mirrored element is noted in the header. A `:not()`
     that mixes a class probe with other selectors, or a selector that tests class names outside
     `:not()`, fails the build.
   - Probe defaults start at upstream's specificity and repeat the probe's `:not()` once per rank.
     Base defaults with the same variant rank in Tailwind's candidate order
     (`compareCandidates` in `scripts/mirror/component.ts`), so of two reaching one icon, the one
     Tailwind puts later wins. A variant option's default outranks every base default.
   - A slot's `leading-*` rule, on a slot that also sets a named text size (`text-sm`), skips the
     elements whose `data-slot` sets a named text size and no leading, as tailwind-merge drops it
     when one component renders through another (`render={<CardDescription />}`).
   - A variant option that sets an arbitrary font size over the base's named one (`text-sm`, then
     `text-[0.8rem]`) and no leading gets `line-height: inherit`, as tailwind-merge drops the named
     size's line-height.
   - Rules that need a configured consumer class (Card's `[.border-b]:` padding) are dropped and
     listed in the module's header and the build log; any other outside class fails the build.
4. Renames Tailwind's internal variables, the ones that compose one property from several
   utilities (a shadow and a focus ring share one `box-shadow`, animate-in's keyframes read
   `--enter-*`), by dropping the `tw-` prefix: `--tw-ring-shadow` becomes `--ring-shadow`. A family
   whose bare names a component already uses is renamed whole (`--tw-translate-*` becomes
   `--transform-translate-*`, since Drawer and Toast set their own `--translate-x`), and a renamed
   variable that collides with a theme token or any other variable fails the build
   (`scripts/mirror/internal.ts`). Upstream registers these globally with `@property`; here each
   module declares defaults for the ones it uses, on the elements that use them, in
   `@layer properties`. A layered rule loses to every unlayered one, and every module declares the
   same constants, so modules never conflict.
5. Lists in the module's header the custom properties it reads and does not set (global tokens,
   or set by an enclosing slot or an inline style). Any class Tailwind produces no CSS for, other
   than `group`/`peer` markers and `classesWithoutCss` entries, fails the build.

Each component's folder is cleared before it is written, so a file the pipeline stops writing does
not linger. Unsupported source shapes fail the build with their line and column rather than
producing partial output.

## Generated tests

Each component gets a `<Name>.test.tsx` (`scripts/mirror/tests.ts`) covering every exported
component: its `data-slot` and classes, every option of every `cva()` group, null groups, literal
prop defaults, and consumer `className`, that other values of boolean and union-typed defaults and
default children change the render, exported hooks (inside the provider their error names) and
re-exported or aliased values.

Parts render inside the same item's parts that enclose them in upstream's docs example, or in the
module's own composition, with their literal props and triggers, opened where upstream's types take
`defaultOpen` (`scripts/mirror/parts.ts`); every other way the example renders a part gets a render
test too. A part that renders no element (Dialog's root) is tested by its children. Tests assert
through the `styles` import, so they pass under any CSS module naming.

## Global stylesheets

The build also generates the `@bje/globals` item every component depends on:

- `variables.scss`: Tailwind's whole default theme, shadcn's light and dark colors, and the
  `@property` registrations of shadcn's own utilities.
- `base.scss`: Tailwind's preflight, shadcn's base layer, and the keyframes components animate
  with.
- `fonts.css`: the font package import (`@fontsource-variable/inter`).

The first two are split out of Tailwind's own output over every mirrored component's classes. The
theme is compiled static (`theme(static)`), so `variables.scss` holds every default theme
variable, not only the ones components read, and no Tailwind internal.

## Typeset

[shadcn/typeset](https://ui.shadcn.com/docs/typeset), the stylesheet for rendered HTML and markdown
inside a `.typeset` container, is plain CSS already, so it ships as `@bje/typeset` unchanged
(`registry/<style>/styles/typeset.css`). Upstream imports it after Tailwind, which makes Tailwind
emit the theme variables it reads (`--color-foreground`, `--font-heading`, ...), so the global
stylesheets are generated with it included.

## Catalog and harness inputs

Last, the build writes the A/B harness inputs to `ab/generated/<style>/`
([visual-ab.md](visual-ab.md)), then `registry/<style>/registry.json` (the root `registry.json`'s
hand-written items followed by the generated ones, with the style's `homepage`) and
`registry/<style>/tsconfig.json`, which maps cross-component imports to the style's own items.

## Formatting and Biome

Generated files get Biome's formatting and safe fixes (import order, `import type`;
`scripts/mirror/format.ts`). They keep upstream's code, so `biome.json` turns off the rules
upstream's code trips for `registry/*/ui/**`. Every other rule still applies there.
`ab/generated/` is written unformatted, and Biome skips it as a gitignored path.
