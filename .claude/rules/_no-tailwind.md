# No Tailwind

This registry does not use Tailwind. The vendored skill at `.claude/skills/shadcn/` assumes it
does; where they disagree, this file wins.

## Disregard in the vendored skill

- `rules/styling.md`: Tailwind utility classes (`bg-primary`, `size-*`, `space-x-*`, ...).
- `customization.md`: `@theme inline`, `tailwind.config.js`, and the Tailwind CSS file.
- Any instruction to run `shadcn init` or `shadcn add` here, or to create a `components.json`.
  This repo produces a registry; it does not consume one.

`registry.md`, `cli.md` (for `shadcn build`), and `rules/base-vs-radix.md` still apply.

## Registry items

- No `tailwindcss`, `tailwind-merge`, `tailwindcss-animate`, or other Tailwind packages in
  `dependencies`, `devDependencies`, or `package.json`.
- No `tailwind` field (deprecated upstream anyway).
- No `css` or `cssVars` fields: the CLI writes them into the consumer's Tailwind CSS entry file.
  Ship styles as files in the item's `files` array instead.
- Compose class names with the registry's own `cn` item (`clsx` only). Do not add
  `tailwind-merge` to it.

The styling approach for components is not decided yet. Ask before introducing one.
