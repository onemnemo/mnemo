import { useEffect, useRef } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { type Toast, type ToastType, useToastStore } from "@/stores/toast"

// Per-type colored system icon (rendered as-is) mirroring ToastItemViewModel.
const TYPE_ICON: Record<ToastType, string> = {
  info: "toast/system_info",
  success: "toast/system_success",
  warning: "toast/system_warning",
  action: "toast/system_error",
  task: "toast/system_process",
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss)
  const timerRef = useRef<HTMLDivElement>(null)
  const accent = `var(--toast-accent-${toast.type})`
  const badge = `var(--toast-icon-badge-${toast.type})`

  useEffect(() => {
    if (toast.durationMs <= 0) return
    const anim = timerRef.current?.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], {
      duration: toast.durationMs,
      easing: "linear",
      fill: "forwards",
    })
    const id = window.setTimeout(() => dismiss(toast.id), toast.durationMs)
    return () => {
      anim?.cancel()
      window.clearTimeout(id)
    }
  }, [toast.id, toast.durationMs, dismiss])

  function runAction(action: NonNullable<Toast["primary"]>) {
    action.onClick()
    if (action.dismissAfter !== false) dismiss(toast.id)
  }

  return (
    <div
      role="status"
      className="pointer-events-auto relative w-80 overflow-hidden rounded-xl border bg-[var(--toast-background-primary)] shadow-elevation-2"
    >
      <div className="flex">
        {/* Accent stripe */}
        <div className="w-1 shrink-0" style={{ backgroundColor: accent }} />

        {/* Icon badge (colored system glyph) */}
        <div
          className="m-3 grid size-10 shrink-0 place-items-center self-start rounded-[10px]"
          style={{ backgroundColor: badge }}
        >
          <AppIcon name={TYPE_ICON[toast.type]} size={22} preserveColors />
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1 py-3 pr-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 text-body-small font-semibold text-[var(--toast-title-color)]">
              {toast.title}
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => {
                toast.onDismissed?.()
                dismiss(toast.id)
              }}
              className="grid size-6 shrink-0 place-items-center rounded-full text-[var(--toast-dismiss-button-foreground)] hover:bg-[var(--toast-dismiss-button-background)]"
            >
              <AppIcon name="common/square-rounded-x" size={14} />
            </button>
          </div>

          {toast.description && (
            <div className="mt-1 text-caption text-[var(--toast-description-color)]">{toast.description}</div>
          )}

          {(toast.primary || toast.secondary) && (
            <div className="mt-2.5 flex justify-end gap-2">
              {toast.secondary && (
                <button
                  type="button"
                  onClick={() => runAction(toast.secondary!)}
                  className="rounded-md bg-secondary px-3 py-1.5 text-caption font-medium text-secondary-foreground"
                >
                  {toast.secondary.label}
                </button>
              )}
              {toast.primary && (
                <button
                  type="button"
                  onClick={() => runAction(toast.primary!)}
                  className="rounded-md px-3 py-1.5 text-caption font-medium text-primary-foreground"
                  style={{ backgroundColor: accent }}
                >
                  {toast.primary.label}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {toast.durationMs > 0 && (
        <div className="h-[3px] w-full bg-[var(--toast-timer-track)]">
          <div ref={timerRef} className="h-full origin-left" style={{ backgroundColor: accent }} />
        </div>
      )}
    </div>
  )
}

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed bottom-6 right-5 z-[9000] flex flex-col gap-2.5">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  )
}
