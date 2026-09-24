// Shapes the mirror writes into the A/B harness inputs, shared with ab/ so
// the generated fixtures are typed where they are read. No imports: ab/
// type-checks this file under its own settings.

export type Literal = string | number | boolean | Literal[] | { [key: string]: Literal }

export type Part = {
  component: string
  props: Record<string, Literal>
  // A part that opens renders its trigger from the example before its
  // children: a submenu stays closed without one. A trigger has none itself.
  trigger?: Omit<Part, 'trigger'>
}

export type Fixture = {
  item: string
  component: string
  label: string
  // The element to hover, focus and disable: its data-slot, if it has one
  slot?: string
  // Its scaffold's ancestors, and its props: the scaffold's and a cva option
  ancestors: Part[]
  props: Record<string, Literal>
  // Whether it renders its name as children
  children: boolean
  // Whether it or an ancestor opens: its popup portals out of the case, so
  // the case is compared as the whole viewport.
  overlay: boolean
}
