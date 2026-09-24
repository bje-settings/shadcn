// Stand-ins for upstream's docs-only Example wrappers
// (@/registry/<style>/components/example). Upstream's version stretches any
// child div without a Tailwind `w-*` class, which our components never carry,
// so it would lay the two sides out differently. These are neutral and
// identical on both pages; the className props still apply, since the
// examples' Tailwind classes compile on both.

import type { ComponentProps } from 'react'

export function ExampleWrapper(props: ComponentProps<'div'>) {
  return <div {...props} />
}

export function Example({
  title,
  children,
  className,
  containerClassName,
  ...props
}: ComponentProps<'div'> & { title?: string; containerClassName?: string }) {
  return (
    <div
      data-slot="example"
      className={containerClassName}
      style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
      {...props}
    >
      {title && <div style={{ padding: '8px 6px', fontSize: 12 }}>{title}</div>}
      <div
        data-slot="example-content"
        className={className}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 24,
          padding: 24,
        }}
      >
        {children}
      </div>
    </div>
  )
}
