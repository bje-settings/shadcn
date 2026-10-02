import { describe, expect, it } from 'vitest'
import { parseBaseColor, parseFontItem, parseStyleIndex, parseUpstreamItem } from './snapshots.ts'

describe('parseUpstreamItem', () => {
  it('keeps the fields the pipeline reads', () => {
    const raw = {
      name: 'badge',
      type: 'registry:ui',
      registryDependencies: ['separator'],
      files: [
        { path: 'a.tsx', type: 'registry:ui', content: 'x' },
        { path: 'b.tsx', type: 'registry:ui' },
      ],
      meta: { ignored: true },
    }
    expect(parseUpstreamItem(raw, 'badge.json')).toEqual({
      name: 'badge',
      type: 'registry:ui',
      registryDependencies: ['separator'],
      files: [
        { path: 'a.tsx', type: 'registry:ui', content: 'x' },
        { path: 'b.tsx', type: 'registry:ui' },
      ],
    })
  })

  it.each([
    ['a non-object', 'x', 'item must be an object'],
    ['files that are not an array', { name: 'a', type: 't', files: {} }, 'files must be an array'],
    ['a file without a path', { name: 'a', type: 't', files: [{ type: 't' }] }, 'files[0].path'],
    [
      'empty content',
      { name: 'a', type: 't', files: [{ path: 'p', type: 't', content: '' }] },
      'files[0].content',
    ],
    [
      'non-string registryDependencies',
      { name: 'a', type: 't', files: [], registryDependencies: [1] },
      'registryDependencies[0]',
    ],
    [
      'registryDependencies that are not an array',
      { name: 'a', type: 't', files: [], registryDependencies: 'x' },
      'registryDependencies must be an array',
    ],
  ])('rejects %s', (_, raw, message) => {
    expect(() => parseUpstreamItem(raw, 'badge.json')).toThrow(`badge.json: ${message}`)
  })
})

describe('parseStyleIndex', () => {
  it('reads a css tree, or none', () => {
    expect(parseStyleIndex({ css: { '@layer base': { body: {} } } }, 'i')).toEqual({
      css: { '@layer base': { body: {} } },
    })
    expect(parseStyleIndex({ name: 'index' }, 'i')).toEqual({})
  })

  it('rejects a css tree with non-object leaves', () => {
    expect(() => parseStyleIndex({ css: { body: 'x' } }, 'i')).toThrow(
      'i: css["body"] must be an object',
    )
  })
})

describe('parseBaseColor', () => {
  it('reads light and dark variables', () => {
    const raw = { cssVarsV4: { light: { a: '1' }, dark: { a: '2' } }, other: 1 }
    expect(parseBaseColor(raw, 'c')).toEqual({ cssVarsV4: { light: { a: '1' }, dark: { a: '2' } } })
  })

  it('rejects a non-string variable', () => {
    expect(() => parseBaseColor({ cssVarsV4: { light: { a: 1 }, dark: {} } }, 'c')).toThrow(
      'c: cssVarsV4.light.a must be a non-empty string',
    )
  })
})

describe('parseFontItem', () => {
  const font = { family: 'Inter', variable: '--font-sans', dependency: '@fontsource/inter' }

  it('reads the title, family, variable and package', () => {
    expect(parseFontItem({ font, name: 'font-inter', title: 'Inter' }, 'f')).toEqual({
      title: 'Inter',
      font,
    })
  })

  it('rejects a variable that is not a custom property', () => {
    expect(() =>
      parseFontItem({ font: { ...font, variable: 'font-sans' }, title: 'Inter' }, 'f'),
    ).toThrow('f: font.variable must be a custom property')
  })

  it('rejects an item without a title', () => {
    expect(() => parseFontItem({ font }, 'f')).toThrow('f: title must be a non-empty string')
  })
})
