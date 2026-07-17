import { Activity, CircleCheck, Info, TriangleAlert, X, Zap, type LucideIcon } from "lucide-react"
import { useEffect, useRef } from "react"

import { type Toast, type ToastType, useToastStore } from "@/stores/toast"

// Per-type icon + the theme token pair (accent color + badge background).
const TYPE_META: Record<ToastType, { icon: LucideIcon; accentVar: string; badgeVar: string }> = {
  info: { icon: Info, accentVar: "--toast-accent-info", badgeVar: "--toast-icon-badge-info" },
  success: { icon: CircleCheck, accentVar: "--toast-accent-success", badgeVar: "--toast-icon-badge-success" },
  warning: { icon: TriangleAlert, accentVar: "--toast-accent-warning", badgeVar: "--toast-icon-badge-warning" },
  action: { icon: Zap, accentVar: "--toast-accent-action", badgeVar: "--toast-icon-badge-action" },
  task: { icon: Activity, accentVar: "--toast-accent-task", badgeVar: "--toast-icon-badge-task" },
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss)
  const timerRef = useRef<HTMLDivElement>(null)
  const meta = TYPE_META[toast.type]
  const Icon = meta.icon

  useEffect(() => {
    if (toast.durationMs <= 0) return
    // Animate the timer bar and auto-dismiss together.
    const anim = timerRef.current?.animate(
      [{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }],
      { duration: toast.durationMs, easing: "linear", fill: "forwards" },
    )
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
      className="pointer-events-auto relative w-80 overflow-hidden rounded-lg border bg-[var(--toast-background-primary)] shadow-elevation-3"
    >
      <div className="flex gap-3 p-3">
        <div
          className="grid size-8 shrink-0 place-items-center rounded-md"
          style={{ backgroundColor: `var(${meta.badgeVar})` }}
        >
          <Icon className="size-4" style={{ color: `var(${meta.accentVar})` }} aria-hidden />
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-body-small font-medium text-[var(--toast-title-color)]">{toast.title}</div>
          {toast.description && (
            <div className="mt-0.5 text-caption text-[var(--toast-description-color)]">{toast.description}</div>
          )}
          {(toast.primary || toast.secondary) && (
            <div className="mt-2 flex gap-2">
              {toast.primary && (
                <button
                  type="button"
                  onClick={() => runAction(toast.primary!)}
                  className="rounded-md px-2 py-1 text-caption font-medium text-primary-foreground"
                  style={{ backgroundColor: `var(${meta.accentVar})` }}
                >
                  {toast.primary.label}
                </button>
              )}
              {toast.secondary && (
                <button
                  type="button"
                  onClick={() => runAction(toast.secondary!)}
                  className="rounded-md px-2 py-1 text-caption font-medium text-text-secondary hover:text-text-primary"
                >
                  {toast.secondary.label}
                </button>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => {
            toast.onDismissed?.()
            dismiss(toast.id)
          }}
          className="grid size-6 shrink-0 place-items-center rounded-md text-[var(--toast-dismiss-button-foreground)] hover:bg-[var(--toast-dismiss-button-background)]"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {toast.durationMs > 0 && (
        <div className="h-0.5 w-full bg-[var(--toast-timer-track)]">
          <div
            ref={timerRef}
            className="h-full origin-left"
            style={{ backgroundColor: `var(${meta.accentVar})` }}
          />
        </div>
      )}
    </div>
  )
}

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  )
}
