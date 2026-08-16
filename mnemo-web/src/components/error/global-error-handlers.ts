import { useI18nStore } from "@/i18n/store"
import { createTranslate } from "@/i18n/translate"
import { toast } from "@/stores/toast"

// A fault that repeats every frame (an animation loop, a retried subscription) would otherwise
// flood the toast stack; the console still gets every occurrence, only the toast is throttled.
const TOAST_THROTTLE_MS = 4000
let lastToastAt = 0

function reportFault(message: string, detail: unknown): void {
  console.error(`[app] ${message}`, detail)

  const now = Date.now()
  if (now - lastToastAt < TOAST_THROTTLE_MS) return
  lastToastAt = now

  const t = createTranslate(useI18nStore.getState().bundle)
  toast.warning(t("App", "UnhandledFaultTitle"))
}

/**
 * `AppErrorBoundary` only sees render, lifecycle and constructor throws. A promise rejected
 * without a `.catch`, or a throw inside an event handler, never reaches a boundary at all, and
 * without this they fail silently: the console gets a stack, the window looks fine, and the
 * user is left staring at whatever half-finished action caused it.
 *
 * Call once, before the first render.
 */
export function installGlobalErrorHandlers(): void {
  window.addEventListener("error", (event) => {
    reportFault("an unhandled error was thrown", event.error ?? event.message)
  })
  window.addEventListener("unhandledrejection", (event) => {
    reportFault("a promise rejected without a handler", event.reason)
  })
}
