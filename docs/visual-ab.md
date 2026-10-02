# Visual A/B

`ab/` renders every mirrored component of one style twice: upstream's source with Tailwind
(`upstream.html`) and ours with CSS modules and the global stylesheets (`ours.html`). Playwright
screenshots each case on both pages and diffs them with pixelmatch. A differing pixel or size, a
page or console error, or a state (hover, focus, disabled) that applies on one side only fails the
case; a state that applies on neither side is not compared. Each case is one test, with a step per
state it compares.

```bash
pnpm ab         # run every case; the HTML report in ab/report/<style> has upstream, ours, diff
pnpm ab:serve   # browse the pages: / (side by side), /upstream.html, /ours.html
pnpm ab:timings # where the last run spent its time, per case kind and per step
```

Each command takes the style's short name from `AB_STYLE` (`AB_STYLE=luma pnpm ab`), the first in
`upstream.styles` when unset (`ab/style.ts`). `pnpm ab` and `pnpm ab:serve` first run
`pnpm mirror:build $AB_STYLE`: that style's whole build, its harness inputs in
`ab/generated/<style>/` included, or every style's when `AB_STYLE` is unset.
Each style serves on its own port, 4400 plus its index in `upstream.styles`, so a server left
running for one style is never reused for another. Results go to `ab/results/<style>`.

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
  mirrored and it passes no consumer class whose styling the mirror drops; `pnpm mirror:build`
  lists the skipped ones and why. Both pages render the same trimmed example source
  (`ab/generated/<style>/examples/`), differing only in which components it imports. The ours page
  styles the examples' own layout classes with unlayered Tailwind utilities
  (`ab/generated/<style>/examples.css`), so a class an example passes to our component outranks
  its `:where()` defaults as tailwind-merge makes it win upstream. `ab/stubs/` stands in for the
  docs-only `Example` wrapper and `IconPlaceholder`.

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
the same browser in the same run, so its version does not affect the comparison.

## CI

Each style runs as its own `ab-style (<style>)` leg behind the required `ab` check, on the runner's
Chrome. A leg appends `pnpm ab:timings` to its job summary and uploads its report as the
`ab-report-<style>` artifact, with images for the failed comparisons only. When a leg skips its
comparison is in [CONTRIBUTING.md](../CONTRIBUTING.md#ci).
