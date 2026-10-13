// vitest.config.ts runs each style's generated tests in its own project. A
// project whose aliases reach another style's output still passes, since the
// styles share their component and class names, so the mapping is pinned here.

import { dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import vitestConfig from '../../vitest.config.ts'
import { builtStyles, forStyle } from './config.ts'
import { parsed, root } from './test-support.ts'

type Project = {
  test?: {
    name?: string
    alias?: Record<string, string>
    include?: string[]
    exclude?: string[]
    env?: Record<string, string>
  }
}
const projects = (vitestConfig.test?.projects ?? []) as Project[]

// Each built style, named for the test title.
const styles = builtStyles(parsed).map((style) => [style.name, style] as const)

describe.each(styles)('vitest project for %s', (_, style) => {
  const config = forStyle(parsed, style)
  const name = `registry/${style.name}`
  const project = projects.find((project) => project.test?.name === name)

  it("runs the style's tests and resolves its cross-component imports to its own output", () => {
    expect(project?.test?.include).toEqual([`${dirname(config.registryFile)}/**/*.test.{ts,tsx}`])
    expect(project?.test?.alias).toEqual({
      [`@/registry/${parsed.namespace}/ui`]: `${root}/${config.outputDir}`,
      [`@/registry/${parsed.namespace}/hooks`]: `${root}/${config.hooksDir}`,
    })
  })

  // CI's leg for the style runs this project: one naming another style, or
  // none, would check the wrong output or nothing.
  it("checks the style's generated output in its own project", () => {
    const generated = projects.find((project) => project.test?.name === `generated/${style.name}`)
    expect(generated?.test?.include).toEqual(['scripts/mirror/generated.test.ts'])
    expect(generated?.test?.env).toEqual({ MIRROR_STYLE: style.name })
  })

  it("covers the style's output", () => {
    expect(vitestConfig.test?.coverage?.include).toContain(
      `${dirname(config.registryFile)}/**/*.{ts,tsx}`,
    )
  })
})

it('runs generated.test.ts only in the per-style projects', () => {
  const scripts = projects.find((project) => project.test?.name === 'scripts')
  expect(scripts?.test?.exclude).toContain('scripts/mirror/generated.test.ts')
})
