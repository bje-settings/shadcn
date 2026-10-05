// Stand-in for next/image, which upstream's docs examples import and which
// needs a Next.js runtime. A plain <img> on both pages: the Next-only props
// are dropped, and `fill` becomes the absolute full-size box Next applies.

import type { ComponentProps } from 'react'

type Source = string | { src: string }

export default function Image({
  src,
  alt,
  fill,
  style,
  priority,
  quality,
  placeholder,
  blurDataURL,
  loader,
  unoptimized,
  ...img
}: Omit<ComponentProps<'img'>, 'src'> & {
  src: Source
  fill?: boolean
  priority?: boolean
  quality?: number | `${number}`
  placeholder?: string
  blurDataURL?: string
  loader?: unknown
  unoptimized?: boolean
}) {
  return (
    <img
      {...img}
      alt={alt}
      src={typeof src === 'string' ? src : src.src}
      style={
        fill ? { position: 'absolute', inset: 0, width: '100%', height: '100%', ...style } : style
      }
    />
  )
}
