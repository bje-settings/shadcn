# mirror.config.json

`mirror.config.json` configures the [mirror pipeline](mirror-pipeline.md). `scripts/mirror/config.ts`
is the reference: it types every key and validates the file by hand, so a missing required key or
a malformed value fails the run with the field's name. A key it does not read, a misspelled
optional one included, is ignored.

## Sources and output

| Key                  | Sets                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `namespace`          | This registry's name: imports and `registryDependencies` point at `@<namespace>/<item>`    |
| `upstream.url`       | An upstream item's URL, with `{style}` and `{name}`                                        |
| `upstream.colorsUrl` | A base color theme's URL, with `{name}`                                                    |
| `upstream.styles`    | The styles mirrored, each published as its own registry; the first is the A/B default      |
| `derived`            | Styles built from an upstream style's snapshots, each `{ name, base }`; none when unset    |
| `theme`              | The preset's `baseColor`, `font` and `iconLibrary` (the library `IconPlaceholder` becomes) |
| `fonts`              | The upstream fonts each style publishes as `@<namespace>/font-<name>`; none when unset     |
| `components`         | The upstream items to mirror                                                               |
| `typeset`            | shadcn/typeset's `stylesheet` URL, and the content `fixtures` (from `fixturesUrl`) A/B renders |
| `preview`            | The `/create` preview blocks the showcase renders; none when unset (below)                |
| `snapshotDir`        | Where `mirror:fetch` writes snapshots, one directory per style                             |
| `outputDir`          | Components                                                                                 |
| `hooksDir`           | Mirrored hooks (`use-mobile`)                                                              |
| `globalsDir`         | The global stylesheets and Typeset                                                         |
| `harnessDir`         | The A/B harness inputs                                                                     |
| `registryFile`       | The style's catalog                                                                        |

`upstream.styles` takes upstream's names (`base-vega`). Each style goes by its short name, without
`base-` (`vega`): in `mirror:build <style>`, `AB_STYLE`, the vitest project names and CI legs, and
its path on the site. Output paths must contain `{style}`, which resolves to the short name.

A `derived` entry's `base` is one of `upstream.styles`, and its `name` (kebab-case) is no other
style's. It goes by `name` wherever an upstream style goes by its short name, and comes after the
upstream styles in every list: `mirror:build`, the vitest projects, CI's build checks, the A/B port,
the style select and the root page. It has no snapshots and no A/B leg of its own.

`preview.url` is a block file's URL, with `{block}` and `{file}` (`index.tsx`, `cards/<name>.tsx`).
`preview.blocks` lists the blocks in the order the showcase's switcher numbers them, as `/create`
does (`preview-02` is 01). `preview.packages` lists modules the cards import beyond the mirrored
items' packages (`react-qr-code`); a card importing any other is skipped.

`theme.font` is the default font: `@<namespace>/globals` imports it and `variables.scss` sets its
variable. `fonts` takes upstream's font item names without `font-` (`geist`, `heading-geist`). This
repository's config lists all of upstream's `registry:font` items, the default one included. Nothing
checks that list against upstream, so a font upstream adds is published only once it is added here.

## Exceptions

The rest records, each with a reason, what the pipeline cannot infer. Every entry applies to every
style. An entry keyed by an item or part fails the run unless the item is in `components` and
exports the part.

| Key                  | For                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------- |
| `consumerClasses`    | Tailwind classes upstream styles gate on when a consumer passes them; rules dropped  |
| `globalClasses`      | Outside classes elements really carry (`dark`, `sr-only`, `rdp-*`, `recharts-*`)     |
| `classesWithoutCss`  | Upstream classes Tailwind compiles to nothing upstream too                           |
| `coverageExclusions` | Items whose upstream logic no generated render reaches (interaction, runtime state) |
| `testSetup`          | Lines a generated test runs first: jsdom stubs (`ResizeObserver`, `matchMedia`, ...) |
| `testProps`          | Props a part needs that no docs example passes as a literal (a Toast's `toast`)      |
| `testExpressions`    | Such props as TypeScript expressions, where JSON cannot hold them (a `Date`)         |
| `unrenderedInTests`  | Parts jsdom renders nothing for; their test checks exactly that                      |
| `sameRenderInTests`  | Props whose other values render the same in the test's scaffold (Sidebar collapsed) |

`consumerClasses` also makes the A/B harness skip the docs examples and `/create` preview cards
that pass one of those classes to a component whose item drops rules gated on it.
`coverageExclusions` leaves the item's component or hook file out of coverage in every style
(`vitest.config.ts`).
