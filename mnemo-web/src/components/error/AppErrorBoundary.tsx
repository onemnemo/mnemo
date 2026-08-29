import { Component, type ErrorInfo, type ReactNode } from "react"

import { CrashScreen } from "./CrashScreen"

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  error: Error | null
}

/**
 * Catches render and lifecycle errors below the app root and shows recovery actions. Recovery
 * reloads the document to reset failed component state.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const hash = window.location.hash || "(none)"
    console.error(`[app] a render error reached the root boundary at ${hash}`, error, info.componentStack)
  }

  render(): ReactNode {
    return this.state.error ? <CrashScreen error={this.state.error} /> : this.props.children
  }
}
