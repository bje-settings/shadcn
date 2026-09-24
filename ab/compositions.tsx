// Hand-written A/B cases for states and compositions the generated fixtures
// cannot express: disabled and invalid buttons, icons, groups of buttons,
// and separators in a layout. Inline styles here are layout scaffolding shared
// by both pages, not component styling.

import type { ReactNode } from 'react'
import { pick, type Ui } from './ui'

function Icon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
    </svg>
  )
}

export const compositions: { name: string; render: (ui: Ui) => ReactNode }[] = [
  {
    name: 'Button disabled',
    render: (ui) => {
      const Button = pick(ui, 'button', 'Button')
      return <Button disabled>Disabled</Button>
    },
  },
  {
    name: 'Button aria-invalid',
    render: (ui) => {
      const Button = pick(ui, 'button', 'Button')
      return <Button aria-invalid>Invalid</Button>
    },
  },
  {
    name: 'Button with icon',
    render: (ui) => {
      const Button = pick(ui, 'button', 'Button')
      return (
        <Button variant="outline">
          <Icon />
          Icon
        </Button>
      )
    },
  },
  {
    name: 'Button icon-sm size',
    render: (ui) => {
      const Button = pick(ui, 'button', 'Button')
      return (
        <Button size="icon-sm" aria-label="Icon">
          <Icon />
        </Button>
      )
    },
  },
  {
    name: 'ButtonGroup horizontal',
    render: (ui) => {
      const ButtonGroup = pick(ui, 'button-group', 'ButtonGroup')
      const Button = pick(ui, 'button', 'Button')
      return (
        <ButtonGroup>
          <Button variant="outline">One</Button>
          <Button variant="outline">Two</Button>
          <Button variant="outline">Three</Button>
        </ButtonGroup>
      )
    },
  },
  {
    name: 'ButtonGroup vertical',
    render: (ui) => {
      const ButtonGroup = pick(ui, 'button-group', 'ButtonGroup')
      const Button = pick(ui, 'button', 'Button')
      return (
        <ButtonGroup orientation="vertical">
          <Button variant="outline">One</Button>
          <Button variant="outline">Two</Button>
          <Button variant="outline">Three</Button>
        </ButtonGroup>
      )
    },
  },
  {
    name: 'ButtonGroup with text and separator',
    render: (ui) => {
      const ButtonGroup = pick(ui, 'button-group', 'ButtonGroup')
      const ButtonGroupText = pick(ui, 'button-group', 'ButtonGroupText')
      const ButtonGroupSeparator = pick(ui, 'button-group', 'ButtonGroupSeparator')
      const Button = pick(ui, 'button', 'Button')
      return (
        <ButtonGroup>
          <ButtonGroupText>Text</ButtonGroupText>
          <Button variant="secondary">Left</Button>
          <ButtonGroupSeparator />
          <Button variant="secondary">Right</Button>
        </ButtonGroup>
      )
    },
  },
  {
    name: 'ButtonGroup nested',
    render: (ui) => {
      const ButtonGroup = pick(ui, 'button-group', 'ButtonGroup')
      const Button = pick(ui, 'button', 'Button')
      return (
        <ButtonGroup>
          <ButtonGroup>
            <Button variant="outline">A</Button>
            <Button variant="outline">B</Button>
          </ButtonGroup>
          <ButtonGroup>
            <Button variant="outline" size="icon">
              <Icon />
            </Button>
          </ButtonGroup>
        </ButtonGroup>
      )
    },
  },
  {
    name: 'Separator horizontal',
    render: (ui) => {
      const Separator = pick(ui, 'separator', 'Separator')
      return (
        <div style={{ width: 200 }}>
          <div>Above</div>
          <Separator />
          <div>Below</div>
        </div>
      )
    },
  },
  {
    name: 'Separator vertical',
    render: (ui) => {
      const Separator = pick(ui, 'separator', 'Separator')
      return (
        <div style={{ display: 'flex', height: 24, alignItems: 'center', gap: 8 }}>
          <span>Left</span>
          <Separator orientation="vertical" />
          <span>Right</span>
        </div>
      )
    },
  },
]
