import { describe, expect, it } from 'vitest'
import { camelCase, pascalCase, registryModule } from './names.ts'

describe('names', () => {
  it('converts kebab-case to PascalCase and camelCase', () => {
    expect(pascalCase('icon-xs')).toBe('IconXs')
    expect(camelCase('button-group')).toBe('buttonGroup')
    expect(camelCase('button')).toBe('button')
  })

  it('keeps existing capitals and digits', () => {
    expect(pascalCase('variantDefault')).toBe('VariantDefault')
    expect(pascalCase('chart-1')).toBe('Chart1')
  })

  it('points an item at its PascalCase module in this registry', () => {
    expect(registryModule('bje', 'button-group')).toBe('@/registry/bje/ui/ButtonGroup/ButtonGroup')
  })
})
