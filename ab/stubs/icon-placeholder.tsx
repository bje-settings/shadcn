// Stand-in for the shadcn docs app's IconPlaceholder, which picks an icon per
// library and is not in the registry. One fixed icon on both pages; data-icon
// and className pass through, since components style on them.

import type { SVGProps } from 'react'

type Libraries = 'lucide' | 'tabler' | 'hugeicons' | 'phosphor' | 'remixicon'

export function IconPlaceholder(
  props: SVGProps<SVGSVGElement> & Partial<Record<Libraries, string>>,
) {
  const { lucide, tabler, hugeicons, phosphor, remixicon, ...svg } = props
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...svg}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h8" />
    </svg>
  )
}
