# shadcn

The `@bje` [shadcn registry](https://ui.shadcn.com/docs/registry): shadcn/ui's Base UI components,
styled with SCSS modules instead of Tailwind.

## Styles

Each mirrored Base UI style is its own registry at `https://shadcn.bje.co/<style>/`: `vega`,
`luma`, `nova`, `maia`, `lyra`, `mira`, `sera` and `rhea`. `frost` is this registry's own style,
built from maia's components. Styles differ in their components' classes, not only in variables,
so a project uses one style. Every style uses shadcn's neutral base color, the Inter font by
default and lucide icons.

Each style's address also serves a showcase: the cards of shadcn's
[/create](https://ui.shadcn.com/create) preview, on its grid, rendered with that style's
components and stylesheets, in light and dark: [vega](https://shadcn.bje.co/vega/),
[luma](https://shadcn.bje.co/luma/), [nova](https://shadcn.bje.co/nova/),
[maia](https://shadcn.bje.co/maia/), [lyra](https://shadcn.bje.co/lyra/),
[mira](https://shadcn.bje.co/mira/), [sera](https://shadcn.bje.co/sera/),
[rhea](https://shadcn.bje.co/rhea/) and [frost](https://shadcn.bje.co/frost/).
[shadcn.bje.co](https://shadcn.bje.co/) links to every style's showcase.

## Setup

The registries are not listed in the shadcn registry directory, so point `@bje` at one style in
the project's `components.json`:

```json
{
  "registries": {
    "@bje": "https://shadcn.bje.co/luma/{name}.json"
  }
}
```

Then `pnpm dlx shadcn add @bje/button`. The entry is needed even when installing an item by URL:
items declare `registryDependencies` as `@bje/<item>`, which resolve only through it.

## Stylesheets

Components and the global stylesheets are SCSS, so the project needs `sass`. Every component item
and `@bje/globals` lists it in `devDependencies`.

Every component depends on `@bje/globals`, which installs three files into `styles/` under the
project's `components` alias. Import each once, at the app's entry:

| File             | Holds                                                                         |
| ---------------- | ----------------------------------------------------------------------------- |
| `variables.scss` | Tailwind's default theme and shadcn's light and dark colors, as custom properties |
| `base.scss`      | Tailwind's preflight, shadcn's base layer and the keyframes components animate with |
| `fonts.css`      | The default font's package import (`@fontsource-variable/inter`)              |

Dark colors apply under a `.dark` class, which shadcn apps set on `<html>`.

The default font is Inter. To use another, install its item, named after upstream's font
(`pnpm dlx shadcn add @bje/font-geist`, or `@bje/font-heading-geist` for headings only), and import
its `styles/fonts/<name>.css` after `variables.scss`. The stylesheet sets one variable
(`--font-sans`, `--font-heading`, `--font-mono` or `--font-serif`) in the same layer and selector
as `variables.scss`, so imported before it, the default wins. The item lists the font's package in
`dependencies`. A heading font reaches component titles (Card, Dialog, Sheet, ...) and Typeset's
headings; your own `h1` to `h6` keep `--font-sans` unless your CSS uses `var(--font-heading)`. No
component reads `--font-serif`: a serif font applies only where your own CSS uses
`var(--font-serif)`.

`@bje/typeset` installs [shadcn/typeset](https://ui.shadcn.com/docs/typeset) unchanged as
`styles/typeset.css`: styles for rendered HTML and markdown inside a `.typeset` container. It reads
the variables in `@bje/globals`.

## Frost

`frost` is maia with a liquid glass surface on Popover, DropdownMenu, Menubar, ContextMenu, Select
and Combobox content, Dialog, AlertDialog, Sheet, Drawer, HoverCard, Tooltip and Card. Each of
those items depends on `@bje/frost-filter`. Mount its `<FrostFilter />` once, at the app's root:

```tsx
import { FrostFilter } from '@/components/ui/FrostFilter/FrostFilter'

export function App() {
  return (
    <>
      <FrostFilter />
      {/* the app */}
    </>
  )
}
```

In Chromium, served over HTTPS or from localhost, the surfaces then refract what lies behind them.
Firefox and Safari cannot render an SVG filter in `backdrop-filter`, so there the surfaces keep a
frosted blur, as they do everywhere without `<FrostFilter />`. `frostSurface`, exported beside it,
gives an element of your own the same treatment, tinted from `--background`. The opacity, edge
highlight, blur and saturation are `--frost-*` custom properties in `variables.scss`; the opacity
and edge highlight differ in dark.

## Tests

Each component ships a `<Name>.test.tsx`. It needs Vitest with `environment: 'jsdom'`; the item
lists the test's `devDependencies`. It asserts through the module's `styles` import, so it passes
under any CSS module naming.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT (`LICENSE`). The published JSON inlines shadcn/ui's source, so shadcn's notice is kept.
