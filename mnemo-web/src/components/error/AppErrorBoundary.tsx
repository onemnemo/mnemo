import { Component, type ErrorInfo, type ReactNode } from "react"

import { CrashScreen } from "./CrashScreen"

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  error: Error | null
}

/**
 * Catches a render, lifecycle or constructor error anywhere below the app root and swaps the
 * whole window for a recovery screen instead of leaving a blank one with no way back.
 *
 * This only sees the errors React itself can see. A throw inside an event handler or a promise
 * rejected without a catch never reaches a boundary; `installGlobalErrorHandlers` in main.tsx
 * covers those separately.
 *
 * There is no automatic retry: React has already discarded the tree below this point, and
 * whatever threw on mount will throw again on the same state. Reload is the only path back,
 * the same way `WidgetBoundary` relies on a remount rather than a retry button.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[app] a render error reached the root boundary", error, info.componentStack)
  }

  render(): ReactNode {
    return this.state.error ? <CrashScreen error={this.state.error} /> : this.props.children
  }
}
