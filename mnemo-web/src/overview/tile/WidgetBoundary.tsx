import { Component, type ErrorInfo, type ReactNode } from "react"

import { UnavailableTile } from "./UnavailableTile"

interface WidgetBoundaryProps {
  /** Logged with the failure, so a crash report names the widget rather than a coordinate. */
  widgetId: string
  children: ReactNode
}

interface WidgetBoundaryState {
  failed: boolean
}

/**
 * Contains one widget's render failure to its own tile.
 *
 * Without this a single widget throwing unmounts the whole board and the user loses every other
 * tile plus the header, for a bug in one of them. The desktop reaches the same outcome by a
 * different route: a widget whose view model fails to construct is handed to the host as a null
 * content, which renders the same placeholder this does.
 *
 * There is no retry. React has already discarded the subtree, and a widget that threw on mount
 * throws again on the same props, so a retry button would be a button that does nothing. Recovery
 * is a remount, which the board gets for free by keying tiles on their instance id.
 */
export class WidgetBoundary extends Component<WidgetBoundaryProps, WidgetBoundaryState> {
  state: WidgetBoundaryState = { failed: false }

  static getDerivedStateFromError(): WidgetBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[overview] widget "${this.props.widgetId}" failed to render`, error, info.componentStack)
  }

  render(): ReactNode {
    return this.state.failed ? <UnavailableTile /> : this.props.children
  }
}
