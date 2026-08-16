import { create } from "zustand"

// Promise-based confirm/input overlays. The desktop app resolves a
// TaskCompletionSource when the user answers; here the request carries the
// promise's resolve callback and the host calls it. Requests queue so
// overlapping prompts serialize instead of stacking.

interface BaseRequest {
  id: string
  title: string
  message?: string
  confirmLabel: string
  cancelLabel: string
}

export interface ConfirmRequest extends BaseRequest {
  kind: "confirm"
  destructive: boolean
  resolve: (value: boolean) => void
}

export interface InputRequest extends BaseRequest {
  kind: "input"
  defaultValue: string
  placeholder?: string
  resolve: (value: string | null) => void
}

export type DialogRequest = ConfirmRequest | InputRequest

export interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

export interface InputOptions {
  title: string
  message?: string
  defaultValue?: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
}

interface DialogState {
  queue: DialogRequest[]
  confirm: (options: ConfirmOptions) => Promise<boolean>
  prompt: (options: InputOptions) => Promise<string | null>
  settle: (id: string, value: boolean | string | null) => void
}

export const useDialogStore = create<DialogState>((set, get) => ({
  queue: [],
  confirm: (options) =>
    new Promise<boolean>((resolve) => {
      const request: ConfirmRequest = {
        kind: "confirm",
        id: crypto.randomUUID(),
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel ?? "Confirm",
        cancelLabel: options.cancelLabel ?? "Cancel",
        destructive: options.destructive ?? false,
        resolve,
      }
      set((state) => ({ queue: [...state.queue, request] }))
    }),
  prompt: (options) =>
    new Promise<string | null>((resolve) => {
      const request: InputRequest = {
        kind: "input",
        id: crypto.randomUUID(),
        title: options.title,
        message: options.message,
        defaultValue: options.defaultValue ?? "",
        placeholder: options.placeholder,
        confirmLabel: options.confirmLabel ?? "Save",
        cancelLabel: options.cancelLabel ?? "Cancel",
        resolve,
      }
      set((state) => ({ queue: [...state.queue, request] }))
    }),
  settle: (id, value) => {
    const request = get().queue.find((r) => r.id === id)
    if (!request) return
    // Resolve with the type each request kind promised.
    if (request.kind === "confirm") request.resolve(value === true)
    else request.resolve(typeof value === "string" ? value : null)
    set((state) => ({ queue: state.queue.filter((r) => r.id !== id) }))
  },
}))

export const dialog = {
  confirm: (options: ConfirmOptions) => useDialogStore.getState().confirm(options),
  prompt: (options: InputOptions) => useDialogStore.getState().prompt(options),
}
