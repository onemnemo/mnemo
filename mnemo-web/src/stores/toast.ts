import { create } from "zustand"

import { getSettingValue } from "@/settings/store"

// Mirrors Mnemo.Core ToastType. Each maps to a --toast-accent-* / --toast-icon-badge-*
// token pair in the theme (see ToastHost).
export type ToastType = "info" | "success" | "warning" | "action" | "progress"

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

export interface ToastUpdate {
  type?: ToastType
  title?: string
  description?: string | null
  notificationAction?: ToastOptions["notificationAction"] | null
  durationMs?: number
  primary?: ToastAction | null
  secondary?: ToastAction | null
  onDismissed?: (() => void) | null
}

export interface Toast extends ToastOptions {
  id: string
  type: ToastType
  title: string
  durationMs: number
  createdAt: number
  revision: number
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

function updateOptional<T>(current: T | undefined, next: T | null | undefined): T | undefined {
  return next === undefined ? current : (next ?? undefined)
}

function updateDuration(current: Toast, type: ToastType, requested: number | undefined): number {
  if (requested !== undefined) return requested
  if (type === "progress") return 0
  if (current.type === "progress") return DEFAULT_DURATION_MS
  return current.durationMs
}

function updateNotificationHistory(history: NotificationEntry[], id: string, patch: ToastUpdate): NotificationEntry[] {
  const current = history.find((notification) => notification.id === id)
  if (!current) return history

  const type = patch.type ?? current.type
  const completed = current.type === "progress" && type !== "progress"
  const updated: NotificationEntry = {
    ...current,
    type,
    title: patch.title ?? current.title,
    description: updateOptional(current.description, patch.description),
    createdAt: completed ? Date.now() : current.createdAt,
    seen: completed ? false : current.seen,
    read: completed ? false : current.read,
    action: updateOptional(current.action, patch.notificationAction),
  }

  if (completed) return [updated, ...history.filter((notification) => notification.id !== id)]
  return history.map((notification) => (notification.id === id ? updated : notification))
}

interface ToastState {
  toasts: Toast[]
  history: NotificationEntry[]
  spawn: (type: ToastType, title: string, options?: ToastOptions) => string
  update: (id: string, patch: ToastUpdate) => void
  dismiss: (id: string) => void
  discard: (id: string) => void
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
      revision: 0,
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
  update: (id, patch) =>
    set((state) => ({
      toasts: state.toasts.map((current) => {
        if (current.id !== id) return current
        const type = patch.type ?? current.type
        return {
          ...current,
          type,
          title: patch.title ?? current.title,
          description: updateOptional(current.description, patch.description),
          notificationAction: updateOptional(current.notificationAction, patch.notificationAction),
          durationMs: updateDuration(current, type, patch.durationMs),
          primary: updateOptional(current.primary, patch.primary),
          secondary: updateOptional(current.secondary, patch.secondary),
          onDismissed: updateOptional(current.onDismissed, patch.onDismissed),
          revision: current.revision + 1,
        }
      }),
      history: updateNotificationHistory(state.history, id, patch),
    })),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  discard: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
      history: state.history.filter((notification) => notification.id !== id),
    })),
  markAllSeen: () => set((state) => ({ history: state.history.map((n) => (n.seen ? n : { ...n, seen: true })) })),
  markAllRead: () =>
    set((state) => ({ history: state.history.map((n) => (n.read ? n : { ...n, read: true, seen: true })) })),
  markRead: (id) =>
    set((state) => ({ history: state.history.map((n) => (n.id === id ? { ...n, read: true, seen: true } : n)) })),
  dismissNotification: (id) => set((state) => ({ history: state.history.filter((n) => n.id !== id) })),
  clearHistory: () => set({ history: [] }),
}))

type ProgressToastOptions = Omit<ToastOptions, "durationMs">

/** Convenience API: `toast.success("Saved")`, `toast.progress("Exporting")`. */
export const toast = {
  info: (title: string, options?: ToastOptions) => useToastStore.getState().spawn("info", title, options),
  success: (title: string, options?: ToastOptions) => useToastStore.getState().spawn("success", title, options),
  warning: (title: string, options?: ToastOptions) => useToastStore.getState().spawn("warning", title, options),
  action: (title: string, options?: ToastOptions) => useToastStore.getState().spawn("action", title, options),
  progress: (title: string, options?: ProgressToastOptions) =>
    useToastStore.getState().spawn("progress", title, { ...options, durationMs: 0 }),
  update: (id: string, patch: ToastUpdate) => useToastStore.getState().update(id, patch),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
  discard: (id: string) => useToastStore.getState().discard(id),
}
