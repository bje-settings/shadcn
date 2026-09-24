// Applies the shadcn CLI's own install-time source transforms, so the mirror
// converts what `shadcn add` writes into a project rather than the registry's
// raw source: IconPlaceholder becomes the configured icon library's component,
// `cn-font-heading` becomes `font-heading` when the project CSS defines
// --font-heading, and the menu hooks resolve for the default menu color.

import { transformFont, transformIcons, transformMenu } from 'shadcn/utils'
import { Project, ScriptKind } from 'ts-morph'
import type { MirrorConfig } from './config.ts'

export async function installTransforms(
  source: string,
  config: MirrorConfig,
  // The project CSS entry, where transformFont looks for --font-heading.
  cssPath: string,
): Promise<string> {
  const project = new Project({ useInMemoryFileSystem: true })
  const sourceFile = project.createSourceFile('component.tsx', source, {
    scriptKind: ScriptKind.TSX,
  })
  // The subset of the CLI's resolved components.json these transforms read.
  const cliConfig = {
    style: config.upstream.style,
    iconLibrary: config.theme.iconLibrary,
    menuColor: 'default',
    menuAccent: 'subtle',
    rtl: false,
    tsx: true,
    rsc: false,
    resolvedPaths: { tailwindCss: cssPath },
  }
  const options = { filename: 'component.tsx', raw: source, config: cliConfig, sourceFile }
  for (const transform of [transformIcons, transformMenu, transformFont]) {
    // biome-ignore lint/suspicious/noExplicitAny: the CLI's full Config type; only the fields above are read.
    await transform(options as any)
  }
  return sourceFile.getFullText()
}
