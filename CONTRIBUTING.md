# Contributing

The registry is generated: `scripts/mirror` converts snapshots of shadcn's Base UI styles into one
registry per style. The internals:

- [docs/mirror-pipeline.md](docs/mirror-pipeline.md): what `pnpm mirror:build` does
- [docs/mirror-config.md](docs/mirror-config.md): every `mirror.config.json` key
- [docs/visual-ab.md](docs/visual-ab.md): the visual A/B harness
- [docs/hosting.md](docs/hosting.md): GitHub Pages and DNS

## Setup

Node and pnpm versions are in `package.json` (`engines`, `packageManager`).

```bash
pnpm install        # also installs the lefthook pre-commit hooks
pnpm mirror:build   # once after cloning: the A/B harness inputs are not committed
```

## Commands

```bash
pnpm mirror:fetch           # snapshot every style's upstream items, examples, index, fonts and base color, and Typeset
pnpm mirror:build [style]   # convert the snapshots for every style, or one (vega)
pnpm build                  # shadcn build per style: validates each catalog, writes public/r/<style>/
pnpm test                   # vitest over every style, coverage held at 100
pnpm ab                     # compare one style's components with upstream, pixel for pixel
pnpm ab:serve               # browse one style's A/B pages
pnpm ab:timings             # where the last A/B run spent its time
```

The A/B commands take the style's short name from `AB_STYLE` (`AB_STYLE=luma pnpm ab`), the first
in `upstream.styles` when unset. One style's tests run as its two vitest projects:

```bash
pnpm exec vitest run --project registry/luma --project generated/luma   # one style's tests
```

The pre-commit hooks (`lefthook.yml`) run Biome, `tsc`, `vitest related` and `pnpm build`, each
when matching files are staged. CI is the enforcement boundary.

## Generated files

Never edit by hand: each style's `registry/<style>/` (`ui/`, `hooks/`, `styles/`, `registry.json`,
`tsconfig.json`), the snapshots under `upstream/`, `ab/generated/`, and
`ab/skipped-examples/<style>.json`.
`scripts/mirror/generated.test.ts` fails when a committed file differs from what the pipeline
produces. To change the output, change `scripts/mirror/` or `mirror.config.json`, then run
`pnpm mirror:build`.

## Adding an upstream item

1. Add its name to `components` in `mirror.config.json`, along with every component it depends on:
   a dependency not listed fails the build.
2. Run `pnpm mirror:fetch`, then `pnpm mirror:build`. The build writes the item into each style's
   `registry/<style>/registry.json`.
3. Where the build or a generated test fails on something the pipeline cannot infer, record it in
   `mirror.config.json` with a reason ([docs/mirror-config.md](docs/mirror-config.md)).
4. Run `pnpm test`, and `pnpm ab` for each style.

## Adding a hand-written item

1. Add the source under `registry/lib/`, with a colocated `*.test.ts(x)`. It is the one hand-written
   directory `registry/tsconfig.json` and `vitest.config.ts` cover.
2. Declare it in the root `registry.json` with `name`, `type`, `title`, `description`, `files`, and
   any npm `dependencies` or `registryDependencies`.
3. Run `pnpm mirror:build` (every style's catalog lists it), then `pnpm build` and `pnpm test`.

## Adding a style

1. Append upstream's name (`base-<style>`) to `upstream.styles` in `mirror.config.json`. The first
   entry is the A/B default.
2. Run `pnpm mirror:fetch`, then `pnpm mirror:build <style>`. Fetch refreshes every style and
   Typeset: discard the other changes, or commit them separately with a full `pnpm mirror:build`,
   as an upstream update.
3. Where the build fails on the style's classes, add the smallest exception to `mirror.config.json`,
   with a reason. Exceptions apply to every style.
4. Add the style to the list in `scripts/mirror/registries.test.ts` and in `README.md`.
5. Run the style's two vitest projects and `AB_STYLE=<style> pnpm ab`.

Everything else reads `upstream.styles`: the vitest projects, the A/B port, `pnpm build`, CI's
per-style legs and the deploy check.

## CI

`.github/workflows/ci.yml` runs on every pull request and every push to `main`. The repository
ruleset Require CI requires five checks by job name; renaming a job needs the ruleset updated too.

| Check    | Passes when                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------- |
| `build`  | `pnpm build` succeeds and writes a non-empty registry for every style                              |
| `vitest` | Every `vitest-leg (<leg>)` passes and their merged coverage is 100, with every leg's files in it   |
| `types`  | `tsc` passes on the scripts, every registry project, the A/B harness and each style's harness inputs |
| `biome`  | `biome ci . --error-on-warnings` passes                                                            |
| `ab`     | Every `ab-style (<style>)` leg passes or skips its comparison                                      |

`vitest` and `ab` are fan-ins over one leg per style, so the required names hold whatever the
styles. `vitest` has one more leg, `shared`, for `scripts/` and `registry/lib/`, which also
validates `lefthook.yml`. The `vitest` job uploads the merged coverage as `code-coverage/vitest`.

An `ab-style` leg skips its comparison, and still reports success, when:

- the pull request is a draft (it runs once marked ready);
- the change touches only Markdown, `.claude/`, `*.test.ts(x)` files, `lefthook.yml`,
  `biome.json`, `vitest.config.ts`, and other styles' `registry/<style>/` or
  `upstream/base-<style>/`.

Every push to `main` runs every leg, then the `deploy` job ([docs/hosting.md](docs/hosting.md)).
