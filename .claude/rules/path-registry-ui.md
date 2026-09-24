---
paths:
  - "registry/ui/**"
  - "registry/hooks/**"
  - "registry/styles/**"
  - "upstream/**"
  - "ab/generated/**"
---

# Generated Files

Everything under `registry/ui/`, `registry/hooks/`, `registry/styles/` and `ab/generated/`,
`upstream/<style>/index.css`, and the generated items in `registry.json` are written by
`scripts/mirror` from the snapshots in `upstream/`. Do not edit any of it, or the snapshots, by
hand: `scripts/mirror/generated.test.ts` fails when a committed file differs from what the pipeline
produces. `ab/generated/` is not committed; `pnpm ab` regenerates it.

- To change a component's output, change the pipeline (`scripts/mirror/`) or `mirror.config.json`,
  then run `pnpm mirror:build`.
- To pick up upstream changes, run `pnpm mirror:fetch` then `pnpm mirror:build`.
- The upstream style, theme and component list live in `mirror.config.json`.
- After changing generated output, run `pnpm ab` to compare it with upstream pixel for pixel.
