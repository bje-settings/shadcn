// Frost's surfaces in every engine, for a style that ships a frost filter
// (playwright.config.ts's FROST; any other style skips). Each item the
// overrides make depend on frost-filter, open on the A/B page of its fixture,
// in light and dark: Chromium draws its backdrop through the refraction
// (backdrop-filter: url(#bje-frost-filter)), and Firefox and WebKit, which
// cannot, keep the blur, with no url(). Its background lets the backdrop
// through, and an inset shadow lights its edge. The page holds the filter
// once. The showcase's header, the one surface outside the registry, is
// checked the same way. The tooltip's arrow is clipped to its outer half.

import { readFileSync } from 'node:fs'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { FROST, OVERRIDES, PORT } from './playwright.config'

const FILTER_ID = 'bje-frost-filter'
const REFRACTION = new RegExp(`url\\("?#${FILTER_ID}"?\\)`)
const THEMES = ['light', 'dark'] as const

// Each frost surface's fixture on the A/B page, and the data-slot of the
// element that wears the frost (Drawer's popup, which holds its content).
const SURFACES: Record<string, { fixture: string; slot: string }> = {
  popover: { fixture: 'PopoverContent', slot: 'popover-content' },
  'dropdown-menu': { fixture: 'DropdownMenuContent', slot: 'dropdown-menu-content' },
  menubar: { fixture: 'MenubarContent', slot: 'menubar-content' },
  'context-menu': { fixture: 'ContextMenuContent', slot: 'context-menu-content' },
  select: { fixture: 'SelectContent', slot: 'select-content' },
  combobox: { fixture: 'ComboboxContent', slot: 'combobox-content' },
  dialog: { fixture: 'DialogContent', slot: 'dialog-content' },
  'alert-dialog': { fixture: 'AlertDialogContent', slot: 'alert-dialog-content' },
  sheet: { fixture: 'SheetContent', slot: 'sheet-content' },
  drawer: { fixture: 'DrawerContent', slot: 'drawer-popup' },
  'hover-card': { fixture: 'HoverCardContent', slot: 'hover-card-content' },
  tooltip: { fixture: 'TooltipContent', slot: 'tooltip-content' },
  card: { fixture: 'Card', slot: 'card' },
}

// The items the overrides give the filter, from overrides.json, so a surface
// added there without a case here fails.
const surfaces = (): string[] => {
  const manifest = JSON.parse(readFileSync(`${OVERRIDES}/overrides.json`, 'utf8'))
  return Object.entries(manifest.registryDependencies as Record<string, string[]>)
    .filter(([, dependencies]) => dependencies.includes('frost-filter'))
    .map(([item]) => item)
    .sort()
}

test.skip(!FROST, 'the style ships no frost filter')

// Chromium refracts. The others blur, with no url(): they accept one there,
// and draw the backdrop unfiltered.
async function expectFrost(page: Page, surface: Locator, browserName: string) {
  const root = page.locator('html')
  const style = () =>
    surface.evaluate((node) => {
      const { backdropFilter, backgroundColor, boxShadow } = getComputedStyle(node)
      return { backdropFilter, backgroundColor, boxShadow }
    })
  if (browserName === 'chromium') {
    await expect(root).toHaveAttribute('data-frost-refraction', '')
    expect((await style()).backdropFilter).toMatch(REFRACTION)
  } else {
    await expect(root).not.toHaveAttribute('data-frost-refraction')
    const { backdropFilter } = await style()
    expect(backdropFilter).toContain('blur(')
    expect(backdropFilter).not.toContain('url(')
  }
  // Translucent: an alpha above 0 and below 1, in any color syntax the
  // engine reports.
  const alpha = /\/\s*0?\.\d*[1-9]\d*\s*\)$|^rgba\([^)]*,\s*0?\.\d*[1-9]\d*\s*\)$/
  expect((await style()).backgroundColor).toMatch(alpha)
  // The highlight along its top edge, an inset shadow.
  expect((await style()).boxShadow).toContain('inset')
  // One filter, with the id the surfaces name.
  await expect(page.locator('filter')).toHaveCount(1)
  await expect(page.locator(`filter#${FILTER_ID}`)).toHaveCount(1)
}

test('every frost surface has a case', () => {
  expect(surfaces()).toEqual(Object.keys(SURFACES).sort())
})

// The tooltip's arrow shows only its half outside the tooltip, clipped on the
// side Base UI places it, so the two tints do not stack into a darker diamond.
test('tooltip arrow', async ({ page }) => {
  await page.goto(
    `http://localhost:${PORT}/ours.html?case=${encodeURIComponent('TooltipContent light')}`,
  )
  const arrow = page.locator('[data-slot="tooltip-content"] [data-side]').first()
  await arrow.waitFor()
  expect(await arrow.evaluate((node) => getComputedStyle(node).clipPath)).toMatch(/^polygon\(/)
})

for (const theme of THEMES) {
  for (const [item, { fixture, slot }] of Object.entries(SURFACES)) {
    test(`${item} ${theme}`, async ({ page, browserName }) => {
      const id = `${fixture} ${theme}`
      await page.goto(
        `http://localhost:${PORT}/ours.html?theme=${theme}&case=${encodeURIComponent(id)}`,
      )
      const surface = page.locator(`[data-slot="${slot}"]`).first()
      await surface.waitFor()
      expect(
        await page.evaluate(() => document.documentElement.classList.contains('dark')),
        '.dark on <html>',
      ).toBe(theme === 'dark')
      await expectFrost(page, surface, browserName)
    })
  }

  test(`showcase header ${theme}`, async ({ page, browserName }) => {
    await page.goto(`http://localhost:${PORT}/showcase.html?theme=${theme}`)
    const header = page.locator('header')
    await header.waitFor()
    await expectFrost(page, header, browserName)
  })
}
