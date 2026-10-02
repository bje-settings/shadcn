---
paths:
  - "registry/*/ui/**"
  - "registry/*/hooks/**"
  - "registry/*/styles/**"
  - "registry/*/registry.json"
  - "registry/*/tsconfig.json"
  - "upstream/**"
  - "ab/generated/**"
  - "ab/skipped-examples/**"
---

# Generated Files

Everything under each style's `registry/<style>/` (`ui/`, `hooks/`, `styles/`, `registry.json`,
`tsconfig.json`), `ab/generated/<style>/`, `ab/skipped-examples/<style>.json` and
`upstream/<style>/index.css` is written by `scripts/mirror` from the snapshots in `upstream/`. The root `registry.json` holds only hand-written items. Do not
edit any of it, or the snapshots, by hand: `scripts/mirror/generated.test.ts` fails when a
committed file differs from what the pipeline produces. `ab/generated/` is not committed; `pnpm ab` regenerates it.

- To change a component's output, change the pipeline (`scripts/mirror/`) or `mirror.config.json`,
  then run `pnpm mirror:build`.
- To pick up upstream changes, run `pnpm mirror:fetch` then `pnpm mirror:build`.
- The upstream styles, theme and component list live in `mirror.config.json`.
- After changing generated output, run `pnpm ab` to compare it with upstream pixel for pixel.
