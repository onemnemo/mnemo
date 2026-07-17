import { create } from "zustand"

// Mirrors Mnemo.Core ToastType. Each maps to a --toast-accent-* / --toast-icon-badge-*
// token pair in the theme (see ToastHost).
export type ToastType = "info" | "success" | "warning" | "action" | "task"

export interface ToastAction {
  label: string
  onClick: () => void
  /** Dismiss the toast after the handler runs (default true). */
  dismissAfter?: boolean
}

export interface ToastOptions {
  description?: string
  /** Milliseconds before auto-dismiss; 0 keeps it until dismissed. Default 5000. */
  durationMs?: number
  primary?: ToastAction
  secondary?: ToastAction
  /** Fired only on explicit user dismiss (the x control), not auto-dismiss or actions. */
  onDismissed?: () => void
}

export interface Toast extends ToastOptions {
  id: string
  type: ToastType
  title: string
  durationMs: number
  createdAt: number
}

export interface NotificationEntry {
  id: string
  type: ToastType
  title: string
  description?: string
  createdAt: number
}

const MAX_VISIBLE = 6
const MAX_HISTORY = 200
const DEFAULT_DURATION_MS = 5000

interface ToastState {
  toasts: Toast[]
  history: NotificationEntry[]
  spawn: (type: ToastType, title: string, options?: ToastOptions) => string
  dismiss: (id: string) => void
  clearHistory: () => void
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  history: [],
  spawn: (type, title, options = {}) => {
    const id = crypto.randomUUID()
    const toast: Toast = {
      ...options,
      id,
      type,
      title,
      durationMs: options.durationMs ?? DEFAULT_DURATION_MS,
      createdAt: Date.now(),
    }
    set((state) => ({
      // Keep the newest MAX_VISIBLE on screen; older ones fall off but stay in history.
      toasts: [...state.toasts, toast].slice(-MAX_VISIBLE),
      history: [{ id, type, title, description: options.description, createdAt: toast.createdAt }, ...state.history].slice(
        0,
        MAX_HISTORY,
      ),
    }))
    return id
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clearHistory: () => set({ history: [] }),
}))

/** Convenience API: `toast.success("Saved")`, `toast.action("Update ready", { primary: {...} })`. */
export const toast = {
  info: (title: string, options?: ToastOptions) => useToastStore.getState().spawn("info", title, options),
  success: (title: string, options?: ToastOptions) => useToastStore.getState().spawn("success", title, options),
  warning: (title: string, options?: ToastOptions) => useToastStore.getState().spawn("warning", title, options),
  action: (title: string, options?: ToastOptions) => useToastStore.getState().spawn("action", title, options),
  task: (title: string, options?: ToastOptions) => useToastStore.getState().spawn("task", title, options),
}
