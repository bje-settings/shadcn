// Frost's surfaces in every engine, for a style that ships a frost filter
// (playwright.config.ts's FROST; any other style skips). Each item the
// overrides make depend on frost-filter, open on the A/B page of its fixtures,
// in light and dark: the floating surfaces, Card, and the page-level controls.
// Chromium draws its backdrop through the shared filter, then the surface's
// own (backdrop-filter: url(#bje-frost-filter) url(#bje-frost-filter-<n>)),
// and Firefox and WebKit, which cannot, keep the blur, with no url(). Its
// background lets the backdrop through, and an inset shadow lights its edge.
// The page holds the shared filter once. A control inside a frost surface (a
// Card on the showcase) keeps maia's look. The tooltip's arrow is clipped to
// its outer half.

import { readFileSync } from 'node:fs'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { FROST, OVERRIDES, PORT } from './playwright.config'

const FILTER_ID = 'bje-frost-filter'
// The shared filter, then the surface's own, then the saturation.
const REFRACTION = new RegExp(
  `^url\\("?#${FILTER_ID}"?\\) url\\("?#(${FILTER_ID}-\\d+)"?\\) saturate\\(1\\.7\\)$`,
)
const THEMES = ['light', 'dark'] as const

// Each item's frost cases: a fixture on the A/B page, and the data-slot of
// the element that wears the frost (Drawer's popup, which holds its content).
// `unpress` clicks a fixture rendered pressed, whose pressed fill (maia's,
// kept) would hide the frost tint.
type Case = { fixture: string; slot: string; unpress?: boolean }
const SURFACES: Record<string, Case[]> = {
  popover: [{ fixture: 'PopoverContent', slot: 'popover-content' }],
  'dropdown-menu': [{ fixture: 'DropdownMenuContent', slot: 'dropdown-menu-content' }],
  menubar: [{ fixture: 'MenubarContent', slot: 'menubar-content' }],
  'context-menu': [{ fixture: 'ContextMenuContent', slot: 'context-menu-content' }],
  select: [
    { fixture: 'SelectContent', slot: 'select-content' },
    { fixture: 'SelectTrigger', slot: 'select-trigger' },
  ],
  combobox: [{ fixture: 'ComboboxContent', slot: 'combobox-content' }],
  dialog: [{ fixture: 'DialogContent', slot: 'dialog-content' }],
  'alert-dialog': [{ fixture: 'AlertDialogContent', slot: 'alert-dialog-content' }],
  sheet: [{ fixture: 'SheetContent', slot: 'sheet-content' }],
  drawer: [{ fixture: 'DrawerContent', slot: 'drawer-popup' }],
  'hover-card': [{ fixture: 'HoverCardContent', slot: 'hover-card-content' }],
  tooltip: [{ fixture: 'TooltipContent', slot: 'tooltip-content' }],
  card: [{ fixture: 'Card', slot: 'card' }],
  button: [
    { fixture: 'Button variant=default', slot: 'button' },
    { fixture: 'Button variant=secondary', slot: 'button' },
    { fixture: 'Button variant=outline', slot: 'button' },
  ],
  'native-select': [{ fixture: 'NativeSelect', slot: 'native-select' }],
  input: [{ fixture: 'Input', slot: 'input' }],
  textarea: [{ fixture: 'Textarea', slot: 'textarea' }],
  toggle: [{ fixture: 'Toggle variant=outline', slot: 'toggle', unpress: true }],
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

// Chromium refracts through both filters, the surface's own built for it.
// The others blur, with no url(): they accept one there, and draw the
// backdrop unfiltered.
async function expectFrost(page: Page, surface: Locator, browserName: string) {
  const root = page.locator('html')
  const style = () =>
    surface.evaluate((node) => {
      const { backdropFilter, backgroundColor, boxShadow } = getComputedStyle(node)
      return { backdropFilter, backgroundColor, boxShadow }
    })
  if (browserName === 'chromium') {
    await expect(root).toHaveAttribute('data-frost-refraction', '')
    await expect.poll(async () => (await style()).backdropFilter).toMatch(REFRACTION)
    const own = REFRACTION.exec((await style()).backdropFilter)?.[1]
    await expect(page.locator(`[data-slot="frost-surfaces"] filter#${own}`)).toHaveCount(1)
  } else {
    await expect(root).not.toHaveAttribute('data-frost-refraction')
    const { backdropFilter } = await style()
    expect(backdropFilter).toContain('blur(')
    expect(backdropFilter).not.toContain('url(')
    await expect(page.locator('[data-slot="frost-surfaces"]')).toHaveCount(0)
  }
  // Translucent: an alpha above 0 and below 1, in any color syntax the
  // engine reports.
  const alpha = /\/\s*0?\.\d*[1-9]\d*\s*\)$|^rgba\([^)]*,\s*0?\.\d*[1-9]\d*\s*\)$/
  expect((await style()).backgroundColor).toMatch(alpha)
  // The highlight along its top edge, an inset shadow.
  expect((await style()).boxShadow).toContain('inset')
  // The shared filter, once.
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
  for (const [item, cases] of Object.entries(SURFACES)) {
    for (const { fixture, slot, unpress } of cases) {
      test(`${item} ${fixture} ${theme}`, async ({ page, browserName }) => {
        const id = `${fixture} ${theme}`
        await page.goto(
          `http://localhost:${PORT}/ours.html?theme=${theme}&case=${encodeURIComponent(id)}`,
        )
        const surface = page.locator(`[data-slot="${slot}"]`).first()
        await surface.waitFor()
        if (unpress) {
          await surface.click()
          await expect(surface).toHaveAttribute('aria-pressed', 'false')
          await page.mouse.move(0, 0)
        }
        expect(
          await page.evaluate(() => document.documentElement.classList.contains('dark')),
          '.dark on <html>',
        ).toBe(theme === 'dark')
        await expectFrost(page, surface, browserName)
      })
    }
  }

  // The showcase's cards hold buttons, inputs and selects: frost behind them
  // already, so they keep maia's own fill and no backdrop filter.
  test(`controls inside a card ${theme}`, async ({ page }) => {
    await page.goto(`http://localhost:${PORT}/showcase.html?theme=${theme}`)
    await page.locator('[data-card]').first().waitFor()
    for (const slot of ['button', 'input', 'select-trigger']) {
      const control = page.locator(`[data-slot="card"] [data-slot="${slot}"]`).first()
      await control.waitFor()
      expect(
        await control.evaluate((node) => getComputedStyle(node).backdropFilter),
        `${slot} in a card`,
      ).toBe('none')
    }
  })
}
