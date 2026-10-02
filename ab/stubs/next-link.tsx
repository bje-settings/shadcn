// Stand-in for next/link, which upstream's docs examples import and which
// needs a Next.js runtime. A plain <a> on both pages: the Next-only props
// are dropped.

import type { ComponentProps } from 'react'

export default function Link({
  prefetch,
  replace,
  scroll,
  shallow,
  passHref,
  ...anchor
}: ComponentProps<'a'> & {
  prefetch?: boolean | null
  replace?: boolean
  scroll?: boolean
  shallow?: boolean
  passHref?: boolean
}) {
  return <a {...anchor} />
}
