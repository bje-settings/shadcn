# No Tailwind

This registry ships no Tailwind. Components are shadcn's, converted to SCSS modules by
`scripts/mirror`. The vendored skill at `.claude/skills/shadcn/` assumes Tailwind; where they
disagree, this file wins.

## Disregard in the vendored skill

- `supporting/styling.md`: Tailwind utility classes (`bg-primary`, `size-*`, `space-x-*`, ...).
- `supporting/customization.md`: `@theme inline`, `tailwind.config.js`, and the Tailwind CSS file.
- Any instruction to run `shadcn init` or `shadcn add` here, or to create a `components.json`.
  This repo produces a registry; it does not consume one.

`supporting/registry.md`, `supporting/cli.md` (for `shadcn build`), and `supporting/base-vs-radix.md`
still apply.

## Registry items

- No `tailwindcss`, `tailwind-merge`, `tailwindcss-animate`, or other Tailwind packages in an
  item's `dependencies` or `devDependencies`. The repo's own `package.json` carries `tailwindcss`,
  `@tailwindcss/node`, `@tailwindcss/vite`, `tw-animate-css`, `cn` and `class-variance-authority`
  only as devDependencies: `scripts/mirror` compiles upstream classes with them, and the A/B
  harness renders upstream's unchanged source with them.
- No `tailwind` field (deprecated upstream anyway).
- No `css` or `cssVars` fields: the CLI writes them into the consumer's Tailwind CSS entry file.
  Ship styles as files in the item's `files` array instead.
- Styling is one SCSS module per component (`Button.module.scss`), generated from upstream's
  Tailwind classes. Tokens stay CSS custom properties.
- Generated components compose classes with `clsx` directly. Do not add `tailwind-merge` to
  anything.
