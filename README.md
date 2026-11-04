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

| File             | Holds                                                                               |
| ---------------- | ----------------------------------------------------------------------------------- |
| `variables.scss` | Tailwind's default theme and shadcn's light and dark colors, as custom properties   |
| `base.scss`      | Tailwind's preflight, shadcn's base layer and the keyframes components animate with |
| `fonts.css`      | The default font's package import (`@fontsource-variable/inter`)                    |

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
and Combobox content, Dialog, AlertDialog, Sheet, Drawer, HoverCard, Tooltip and Card. Button
(default, secondary and outline), NativeSelect, Input, Textarea, the Select trigger and the
outline Toggle get it too, where no other frost surface holds them: the default Button keeps its
primary tint, and the others take the card's. Each of those items depends on `@bje/frost-filter`.
Mount its `<FrostFilter />` once, at the app's root:

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

In Chromium, served over HTTPS or from localhost, the surfaces then refract what lies behind them:
a shared filter sends waves through each surface, and a filter of its own, rebuilt as it resizes,
bends its rim like a lens and lights its bottom-right edge. Firefox and Safari cannot render an
SVG filter in `backdrop-filter`, so there the surfaces keep a frosted blur, as they do everywhere
without `<FrostFilter />`. `frostSurface`, exported beside it, gives an element of your own the
same treatment, tinted from `--background`. The opacity, edge highlight, blur and saturation are
`--frost-*` custom properties in `variables.scss`; the edge highlight differs in dark. In light,
`--border` and `--input` are the foreground at 6%, so lines let the backdrop through too.

## Intentional divergences

Where the items differ from upstream's, each on purpose:

- **Breadcrumb**: `BreadcrumbPage` renders a plain `span` with `aria-current="page"`, without
  `role="link"` or `aria-disabled`. The
  [WAI-ARIA breadcrumb pattern](https://www.w3.org/WAI/ARIA/apg/patterns/breadcrumb/) marks the
  current page as a link or as plain text, and a span that navigates nowhere is not a link.
- **Slider**: `getAriaLabel` and `getAriaValueText` pass through to every thumb. Base UI reads them
  on the thumb, not the root, so without them a range slider cannot name its thumbs.
- **ScrollArea**, **Pagination** and **Field**: no unused `React` import in ScrollArea, no
  redundant `role="navigation"` on Pagination's `nav`, and `===` in `FieldError` in place of
  `==`, so Biome's `noUnusedImports`, `noRedundantRoles` and `noDoubleEquals` pass on them.
- **Calendar**: a `biome-ignore lint/correctness/noComponentHookFactories` comment sits above
  each of the `Root`, `Chevron`, `DayButton` and `WeekNumber` render functions that upstream
  passes to react-day-picker's `components` prop inline. The functions stay inline, where
  upstream writes them; the patch adds only the comments.

The patches in `scripts/mirror/patches.ts` keep these upstream patterns and put a `biome-ignore`,
with the rule and a reason, before each site, so Biome's recommended rules pass on every item with
no override:

- `useSemanticElements`: ButtonGroup, Field, InputGroup and InputGroupAddon render a `div` with
  `role="group"`, Carousel one with `role="region"` and CarouselItem one with `role="group"`,
  InputOTPSeparator one with `role="separator"` and ItemGroup one with `role="list"`. The element
  Biome suggests (`fieldset`, `section`, `hr`, `ul`) would change the box and the semantics, and an
  `hr` cannot hold the separator's icon.
- `noArrayIndexKey`: FieldError's errors, Chart's tooltip and legend items and Slider's thumbs are
  keyed by their index, as upstream keys them.
- `useKeyWithClickEvents`: InputGroupAddon focuses its input when clicked; the input itself is
  reachable by keyboard.
- `noLabelWithoutControl`: Label renders a native `label`; you associate it with `htmlFor` or by
  nesting the control.
- `useExhaustiveDependencies`: SidebarProvider's `toggleSidebar` and context value list
  `setOpenMobile`, a stable state setter, in their dependencies.
- `noDocumentCookie`: SidebarProvider keeps its open state by assigning `document.cookie`.
- `noDangerouslySetInnerHtml`: ChartStyle injects the chart's CSS variables as a `style` element.

The stylesheets need no patch. The pipeline keeps the first three patterns below with a
suppression, and changes upstream's compiled CSS for the last two:

- `noImportantStyles`: each `!important` declaration, from upstream's `!` modifier or preflight's
  `[hidden]` rule, sits in a suppression.
- `noDescendingSpecificity`: Avatar's `.avatarGroupCount > svg` and Bubble's content hover in its
  outline, ghost and destructive variants keep upstream's cascade order, with a suppression;
  moving them would move a declaration past another.
- `noUnknownUnit`: a stylesheet with a custom property whose hex colour Biome reads as a number
  and a unit (`#0000001a`) has a file-level `biome-ignore-all` in its header, for Biome's own bug
  [biomejs/biome#12332](https://github.com/biomejs/biome/issues/12332).
- A property a block sets twice keeps only the declaration the cascade applies, as tailwind-merge
  keeps the later class upstream.
- A slot's empty `:where()` block is left out, since Sass drops it anyway.

Two upstream defaults stay, and your `role` replaces them:

- **Alert** renders `role="alert"`, announced at once. Pass `role="status"` for a message that can
  wait.
- **Button** rendered as a link (`nativeButton={false}`, `render={<a />}`) gets Base UI's
  `role="button"`. Pass `role="link"` for it to be announced as a link.

## Tests

Each component ships a `<Name>.test.tsx`. It needs Vitest with `environment: 'jsdom'`; the item
lists the test's `devDependencies`. It asserts through the module's `styles` import, so it passes
under any CSS module naming.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT (`LICENSE`). The published JSON inlines shadcn/ui's source, so shadcn's notice is kept.
