import { describe, expect, it } from 'vitest'
import { formatWithBiome } from './format.ts'

const root = process.cwd()

describe('formatWithBiome', () => {
  it('formats TypeScript and JSON with the repo config', () => {
    expect(formatWithBiome(root, 'a.tsx', 'const a = "x";\n')).toBe("const a = 'x'\n")
    expect(formatWithBiome(root, 'a.json', '{"a":[1]}')).toBe('{ "a": [1] }\n')
  })

  it("applies Biome's safe fixes", () => {
    const code = "import * as React from 'react'\nexport const a: React.FC = () => null\n"
    expect(formatWithBiome(root, 'a.tsx', code)).toBe(
      "import type * as React from 'react'\nexport const a: React.FC = () => null\n",
    )
  })

  it('formats stylesheets', () => {
    expect(formatWithBiome(root, 'a.module.scss', 'a{b:c}')).toBe('a {\n  b: c;\n}\n')
    expect(formatWithBiome(root, 'a.css', 'a{opacity:.5}')).toBe('a {\n  opacity: 0.5;\n}\n')
  })
})
