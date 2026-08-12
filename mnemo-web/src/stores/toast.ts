import { create } from "zustand"

import { getSettingValue } from "@/settings/store"

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
  /** Carried into the notification list, where it outlives the toast. */
  notificationAction?: { label: string; href: string }
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
  /** Cleared when the flyout is opened: it drives the dot on the bell. */
  seen: boolean
  /** Cleared when the flyout is closed: it drives the marker on the row. */
  read: boolean
  /** Somewhere to go about it. Toast actions are callbacks and cannot outlive their toast; a link can. */
  action?: { label: string; href: string }
}

const MAX_VISIBLE = 6
const MAX_HISTORY = 200
const DEFAULT_DURATION_MS = 5000

interface ToastState {
  toasts: Toast[]
  history: NotificationEntry[]
  spawn: (type: ToastType, title: string, options?: ToastOptions) => string
  dismiss: (id: string) => void
  /** Kills the dot on the bell. Called when the flyout opens. */
  markAllSeen: () => void
  /** Kills the row markers. Called when the flyout closes, so the list you are looking at stays the list you opened. */
  markAllRead: () => void
  markRead: (id: string) => void
  dismissNotification: (id: string) => void
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
    // App.EnableToasts only silences the pop-up card; the notification list still
    // gets every entry, so turning it off loses nothing, just the interruption.
    const showPopup = getSettingValue("App.EnableToasts", true)
    set((state) => ({
      // Keep the newest MAX_VISIBLE on screen; older ones fall off but stay in history.
      toasts: showPopup ? [...state.toasts, toast].slice(-MAX_VISIBLE) : state.toasts,
      history: [
        {
          id,
          type,
          title,
          description: options.description,
          createdAt: toast.createdAt,
          seen: false,
          read: false,
          action: options.notificationAction,
        },
        ...state.history,
      ].slice(0, MAX_HISTORY),
    }))
    return id
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  markAllSeen: () => set((state) => ({ history: state.history.map((n) => (n.seen ? n : { ...n, seen: true })) })),
  markAllRead: () =>
    set((state) => ({ history: state.history.map((n) => (n.read ? n : { ...n, read: true, seen: true })) })),
  markRead: (id) =>
    set((state) => ({ history: state.history.map((n) => (n.id === id ? { ...n, read: true, seen: true } : n)) })),
  dismissNotification: (id) => set((state) => ({ history: state.history.filter((n) => n.id !== id) })),
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
