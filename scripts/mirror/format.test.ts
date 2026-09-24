import { describe, expect, it } from 'vitest'
import { formatWithBiome } from './format.ts'

const root = process.cwd()

describe('formatWithBiome', () => {
  it('formats TypeScript and JSON with the repo config', () => {
    expect(formatWithBiome(root, 'a.tsx', 'const a = "x";\n')).toBe("const a = 'x'\n")
    expect(formatWithBiome(root, 'a.json', '{"a":[1]}')).toBe('{ "a": [1] }\n')
  })

  it('passes stylesheets through untouched', () => {
    expect(formatWithBiome(root, 'a.module.scss', 'a{b:c}')).toBe('a{b:c}')
    expect(formatWithBiome(root, 'a.css', '@source "./x";')).toBe('@source "./x";')
  })
})
