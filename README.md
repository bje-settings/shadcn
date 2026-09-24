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
vendored in `.claude/skills/shadcn/`, with its source pinned in `skills-lock.json`. It assumes
Tailwind; `.claude/rules/_no-tailwind.md` overrides that.

The vendored copy differs from upstream to follow the
[skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices):

- `rules/` renamed to `supporting/`, since these are
  [supporting files](https://code.claude.com/docs/en/skills#add-supporting-files), not Claude Code rules
- `agents/` and `assets/` removed (OpenAI Codex metadata)
- `mcp.md` removed (not referenced from `SKILL.md`, and no shadcn MCP server is configured)
- `evals/` removed (authoring test cases, never loaded at runtime)
- Tables of contents added to `registry.md` and `supporting/icons.md` (over 100 lines)

`npx skills update shadcn` replaces the directory with upstream, so reapply these changes after
updating.
