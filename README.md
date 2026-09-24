# shadcn

Source for the `@bje` [shadcn registry](https://ui.shadcn.com/docs/registry).

## Layout

| Path             | Purpose                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| `registry.json`  | Registry catalog (`name: "bje"`); every item is declared here           |
| `registry/`      | Item source files, grouped by type (`lib/`, later `ui/`, `hooks/`, ...) |
| `public/r/`      | `pnpm build` output, one JSON file per item (gitignored)                |

## Development

```bash
pnpm install   # also installs the lefthook pre-commit hooks
pnpm build     # shadcn build: validates registry.json and writes public/r/
pnpm test      # vitest with 100% coverage thresholds
```

## Adding an item

1. Add the source under `registry/<type>/`, with a colocated `*.test.ts(x)`.
2. Declare it in `registry.json` with `name`, `type`, `title`, `description`, `files`, and any npm
   `dependencies` or `registryDependencies`.
3. Run `pnpm build` and `pnpm test`.

## Hosting

Not decided yet. Publishing to the shadcn registry directory is tracked in #1.

## Claude Code

`.claude/settings.json` enables the TypeScript LSP plugin and disables auto memory and attribution.
The `shadcn` skill from [shadcn/ui](https://github.com/shadcn-ui/ui/tree/main/skills/shadcn) is
vendored in `.claude/skills/shadcn/` and pinned in `skills-lock.json`. Update it with:

```bash
npx skills update shadcn
```
