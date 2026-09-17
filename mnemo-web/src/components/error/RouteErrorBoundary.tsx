import { Component, type ErrorInfo, type ReactNode } from "react"

import { RouteCrashPanel } from "./RouteCrashPanel"

interface RouteErrorBoundaryProps {
  /** The location hash the boundary is standing in for; a change to it discards a caught error. */
  hash: string
  /** The route key, for the log line and for whoever needs to forget what the route remembered. */
  routeKey: string
  onCatch?: (routeKey: string, error: Error) => void
  children: ReactNode
}

interface RouteErrorBoundaryState {
  error: Error | null
  /** The hash the error was caught under. */
  hash: string
}

/**
 * Contains one route's render failure to the canvas.
 *
 * Without this a page throwing reaches the root boundary, which replaces the whole window with
 * the crash screen: sidebar, titlebar and dock go with it, for a bug in one page. Here the chrome
 * stands, and the user can pick another page.
 *
 * There is no retry. React has discarded the subtree, and a page that threw on mount throws
 * again on the same hash. Recovery is navigation: the error is dropped the moment the hash
 * changes, and the new route mounts fresh. The reset is done from the hash rather than by
 * keying the boundary on it, because a key would also remount the route on every ordinary
 * navigation inside it, one note to the next among them.
 */
export class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = { error: null, hash: this.props.hash }

  static getDerivedStateFromError(error: Error): Partial<RouteErrorBoundaryState> {
    return { error }
  }

  static getDerivedStateFromProps(
    props: RouteErrorBoundaryProps,
    state: RouteErrorBoundaryState,
  ): Partial<RouteErrorBoundaryState> | null {
    return props.hash === state.hash ? null : { error: null, hash: props.hash }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[app] the ${this.props.routeKey} route failed to render at ${this.props.hash}`, error, info.componentStack)
    this.props.onCatch?.(this.props.routeKey, error)
  }

  render(): ReactNode {
    return this.state.error ? <RouteCrashPanel error={this.state.error} /> : this.props.children
  }
}
