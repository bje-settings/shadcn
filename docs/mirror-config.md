# mirror.config.json

`mirror.config.json` configures the [mirror pipeline](mirror-pipeline.md). `scripts/mirror/config.ts`
is the reference: it types every key and validates the file by hand, so a typo fails the run with
the field's name. Keys it does not read are ignored.

## Sources and output

| Key                  | Sets                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `namespace`          | This registry's name: imports and `registryDependencies` point at `@<namespace>/<item>`    |
| `upstream.url`       | An upstream item's URL, with `{style}` and `{name}`                                        |
| `upstream.colorsUrl` | A base color theme's URL, with `{name}`                                                    |
| `upstream.styles`    | The styles mirrored, each published as its own registry; the first is the A/B default      |
| `theme`              | The preset's `baseColor`, `font` and `iconLibrary` (the library `IconPlaceholder` becomes) |
| `components`         | The upstream items to mirror                                                               |
| `typeset`            | shadcn/typeset's `stylesheet` URL, and the content `fixtures` (from `fixturesUrl`) A/B renders |
| `snapshotDir`        | Where `mirror:fetch` writes snapshots, one directory per style                             |
| `outputDir`          | Components                                                                                 |
| `hooksDir`           | Mirrored hooks (`use-mobile`)                                                              |
| `globalsDir`         | The global stylesheets and Typeset                                                         |
| `harnessDir`         | The A/B harness inputs                                                                     |
| `registryFile`       | The style's catalog                                                                        |

`upstream.styles` takes upstream's names (`base-vega`). Each style goes by its short name, without
`base-` (`vega`): in `mirror:build <style>`, `AB_STYLE`, the vitest project names and CI legs, and
its path on the site. Output paths must contain `{style}`, which resolves to the short name.

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

`consumerClasses` also makes the A/B harness skip the docs examples that pass those classes.
`coverageExclusions` leaves the item's component or hook file out of coverage in every style
(`vitest.config.ts`).
