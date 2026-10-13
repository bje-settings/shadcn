# Visual A/B

`ab/` renders every mirrored component of one style twice: upstream's source with Tailwind
(`upstream.html`) and ours with CSS modules and the global stylesheets (`ours.html`). Playwright
screenshots each case on both pages and diffs them with pixelmatch. A differing pixel or size, a
page or console error, or a state (hover, focus, disabled) that applies on one side only fails the
case; a state that applies on neither side is not compared. Each case is one test, with a step per
state it compares.

```bash
pnpm ab         # run every case; the HTML report in ab/report/<style> has upstream, ours, diff
pnpm ab:serve   # browse the pages: / (side by side), /upstream.html, /ours.html, /showcase.html, /site.html
pnpm ab:timings # where the last run spent its time, per case kind and per step
```

Each command takes the style's name from `AB_STYLE` (`AB_STYLE=luma pnpm ab`), the first in
`upstream.styles` when unset (`ab/style.ts`). `pnpm ab` and `pnpm ab:serve` first run
`pnpm mirror:build $AB_STYLE`: that style's whole build, its harness inputs in
`ab/generated/<style>/` included, or every style's when `AB_STYLE` is unset.
Each style serves on its own port, 4400 plus its index in every built style, upstream styles first
and derived ones after (frost serves on 4408), so a server left running for one style is never
reused for another. Results go to `ab/results/<style>`.

## Cases

Every case is generated (`scripts/mirror/harness.ts`):

- **Fixtures:** each exported component that renders an element, per `cva()` option
  (`ab/generated/<style>/fixtures.ts`), in light and dark, at rest, hovered, keyboard-focused and
  disabled. Each renders in the same scaffold as its generated test. A fixture inside an opened
  part (a popup) renders alone on its page and compares the whole viewport.
- **Typeset:** each of Typeset's content fixtures (docs, chat, changelog, ...) inside `.typeset`,
  in light and dark.
- **Examples:** each sub-example of upstream's docs example for a mirrored component
  (`<item>-example`), in light and dark. A sub-example is used once every component it reaches is
  mirrored, it passes no component a consumer class that the component's item drops rules gated on
  (`border-b` on a Card part), and it is not one of the `KNOWN_DIFFERENCES` in
  `scripts/mirror/examples.ts`; `pnpm mirror:build` lists the skipped ones and why, and records
  them in `ab/skipped-examples/<style>.json`, which `generated.test.ts` holds to the build, so a
  new skip fails until it is committed. Both pages render the same trimmed
  example source (`ab/generated/<style>/examples/`), differing only in which components it
  imports. The ours page styles the examples' own layout classes with unlayered Tailwind utilities
  (`ab/generated/<style>/examples.css`), so a class an example passes to our component outranks
  its `:where()` defaults as tailwind-merge makes it win upstream. `ab/stubs/` stands in for the
  docs-only `Example` wrapper, `IconPlaceholder`, `next/image` and `next/link`.
- **Showcase:** one test (`ab/showcase.spec.ts`) opens the style's showcase page
  (`showcase.html`, ours only), and through its switcher and theme toggle renders each `/create`
  preview block in light and dark, then opens the last block in dark from the URL. It fails on a
  card that renders its error, a page error, cards other than those the block's snapshotted index
  imports less those in `ab/skipped-cards/<style>.json`, in another order than the index renders
  them or other than as many times as it renders each, a `style-overview` card that does not name
  the style and the theme's font, or a grid that does not lay the cards out in upstream's seven
  columns with a gap, a column spanning as many tracks as its `col-span` says. It also checks the
  header: the heading names the style, the logo is 42px by 42px (also at a 375px viewport), and the style select sits outside
  the heading, lists every configured style with this one chosen, and requests the chosen style's
  page with the block and theme kept. Nothing is compared with upstream.
- **Root page:** one test (`ab/site.spec.ts`) opens the site's root page (`site.html`) in the dark
  theme. It fails on a page error, cards other than one per configured style in config order, each
  titled with the style's name and linking to `./<style>/`, a heading named other than `bje`, a
  preview switcher, a style select with a style chosen or other than its disabled "Choose a style"
  prompt followed by every configured style, a theme toggle that does not switch `.dark` on
  `<html>` and `?theme=` both ways, or a style choice that requests anything but the style's page
  with the theme kept and no block. The site builds the root page with the first style in
  `upstream.styles`, so the test runs only for that style and skips for the others.

- **Frost:** for a style that ships a frost filter (its overrides hold `FrostFilter`), one test
  per surface and theme (`ab/frost.spec.ts`) opens each item `overrides.json` makes depend on
  `frost-filter` on its fixture's page (`ours.html?case=PopoverContent light`), and the showcase's
  header. Both pages mount `<FrostFilter />` once, as a consumer does. It fails, from computed
  style, when in Chromium the surface's `backdrop-filter` is not the refraction
  (`url(#bje-frost-filter)`) or `<html>` lacks `data-frost-refraction`; when in Firefox or WebKit
  it has no `blur(` or any `url(`; when its background is not translucent (alpha 0 or 1); when it
  has no inset shadow along its edge; or when the page holds other than one `<filter>`. A surface
  `overrides.json` adds without a case here fails too, and so does a tooltip arrow without its
  `clip-path`. Every other style skips it.

## How a run compares

Each worker opens one page per side and theme and shows its cases one at a time (`showCase()`),
waiting for fonts, images, animations and a quiet DOM before the screenshot. A fixture is compared
at rest, hovered and focused on one render, which is shown again only when a state changed its DOM
(a hover that opened a card), then rendered disabled if its element honours `disabled`. Images the
examples load from the web are replaced with one local image on both sides. A case that throws
renders its error in place and fails alone.

Each theme renders on its own page with `.dark` on `<html>`, as shadcn apps toggle it, so variables
that resolve at the root switch too. `?theme=dark` and `?case=<id>` select the theme and narrow a
page to one case. Playwright uses the installed Chrome (`channel: 'chrome'`): both sides render in
the same browser in the same run, so its version does not affect the comparison. For a style that
ships a frost filter, `ab/playwright.config.ts` adds Firefox and WebKit projects that run
`frost.spec.ts` alone (`pnpm exec playwright install firefox webkit` downloads them). Their
headless builds report `backdrop-filter` but paint no backdrop blur, so the spec reads computed
style, not pixels.

## CI

Each upstream style runs as its own `ab-style (<style>)` leg behind the required `ab` check, on the
runner's Chrome. A derived style has no leg: it has no upstream to compare with. Frost has its own
`frost` job behind the same check instead: it installs Firefox and WebKit, then runs
`AB_STYLE=frost pnpm ab frost.spec.ts` in all three browsers and `AB_STYLE=frost pnpm ab
showcase.spec.ts`, and uploads its report as `ab-report-frost` when either fails. A leg appends
`pnpm ab:timings` to its job summary and uploads its report as the `ab-report-<style>` artifact,
with images for the failed comparisons only. When a leg skips its comparison is in
[CONTRIBUTING.md](../CONTRIBUTING.md#ci).
