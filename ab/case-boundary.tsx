// A case or card that throws renders its error in place, marked
// data-case-error, so it fails alone rather than blanking the page. The A/B
// gallery and the showcase both wrap each render in it.

import { Component, type ReactNode } from 'react'

export class CaseBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  override state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override render() {
    const { error } = this.state
    return error ? <pre data-case-error={error.message}>{error.message}</pre> : this.props.children
  }
}
