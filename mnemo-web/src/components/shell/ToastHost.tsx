import { useEffect, useRef, useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"
import { Z_LAYERS } from "@/lib/z-layers"
import { type Toast, type ToastType, useToastStore } from "@/stores/toast"

/**
 * How each kind of toast announces itself.
 *
 * Info gets a mark rather than an icon. It keeps the text column aligned with
 * the toasts that do have something to say, without inventing a meaning for a
 * message that only means "noted".
 */
const GLYPH: Record<ToastType, { icon: string | null; className: string; spin?: boolean }> = {
  info: { icon: null, className: "" },
  success: { icon: "check", className: "text-ink" },
  warning: { icon: "triangle-alert", className: "text-[var(--state-learn)]" },
  action: { icon: "circle-alert", className: "text-danger" },
  task: { icon: "loader-circle", className: "text-ink-3", spin: true },
}

function Glyph({ type }: { type: ToastType }) {
  const glyph = GLYPH[type]
  if (!glyph.icon) return <span className="size-1.5 rounded-full bg-ink-3" />
  return (
    <AppIcon
      name={glyph.icon}
      size={16}
      strokeWidth={type === "success" ? 2.2 : 1.9}
      className={cn(glyph.className, glyph.spin && "animate-spin")}
    />
  )
}

function ToastRow({ toast, paused }: { toast: Toast; paused: boolean }) {
  const t = useT()
  const dismiss = useToastStore((s) => s.dismiss)
  const drainRef = useRef<HTMLSpanElement>(null)
  const [leaving, setLeaving] = useState(false)

  const sticky = toast.durationMs <= 0
  // The line is only drawn when the toast is holding something you can still
  // act on, because that is the only case where running out of time costs you
  // anything. It runs regardless, because it is also the clock.
  const showsDrain = !sticky && (toast.primary != null || toast.secondary != null)

  useEffect(() => {
    if (sticky) return
    const animation = drainRef.current?.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], {
      duration: toast.durationMs,
      easing: "linear",
      fill: "forwards",
    })
    if (!animation) return

    // The animation is the clock, not a decoration alongside one. A separate
    // timer would keep running while this is paused, and the toast would vanish
    // with the line still half full.
    animation.finished.then(() => dismiss(toast.id)).catch(() => {})
    return () => animation.cancel()
  }, [toast.id, toast.durationMs, sticky, dismiss])

  useEffect(() => {
    const animation = drainRef.current?.getAnimations()[0]
    if (!animation) return
    if (paused) animation.pause()
    else animation.play()
  }, [paused])

  function close(): void {
    setLeaving(true)
    toast.onDismissed?.()
    window.setTimeout(() => dismiss(toast.id), 180)
  }

  function runAction(action: NonNullable<Toast["primary"]>): void {
    action.onClick()
    if (action.dismissAfter !== false) dismiss(toast.id)
  }

  return (
    // grid-rows 1fr to 0fr is what makes the stack settle instead of jump: the
    // dismissed row collapses its own height, and the gap collapses with it
    // because the gap is padding on the collapsing element.
    <div
      className="grid w-full max-w-[460px] transition-[grid-template-rows,opacity] ease-out"
      style={{
        gridTemplateRows: leaving ? "0fr" : "1fr",
        opacity: leaving ? 0 : 1,
        transitionDuration: "var(--duration-normal)",
      }}
    >
      <div className="min-h-0 overflow-hidden pt-2">
        <div
          role="status"
          className={cn(
            "animate-toast-in group/toast pointer-events-auto relative flex items-start gap-2.5",
            "overflow-hidden rounded-xl bg-canvas py-2 pl-3 pr-2 shadow-pop transition-transform",
            leaving && "scale-[0.97]",
          )}
          style={{ transitionDuration: "var(--duration-normal)" }}
        >
          <span className="mt-[3px] grid size-4 shrink-0 place-items-center">
            <Glyph type={toast.type} />
          </span>

          <div className="min-w-0 flex-1 py-px">
            <p className="text-[13px] font-medium leading-[17px] tracking-[-0.006em] text-ink">{toast.title}</p>
            {toast.description && <p className="mt-0.5 text-[12px] leading-[16px] text-ink-3">{toast.description}</p>}
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            {toast.secondary && (
              <button
                type="button"
                onClick={() => runAction(toast.secondary!)}
                className="h-7 rounded-lg px-2.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:bg-frame-hover hover:text-ink"
              >
                {toast.secondary.label}
              </button>
            )}
            {toast.primary && (
              <button
                type="button"
                onClick={() => runAction(toast.primary!)}
                className="h-7 rounded-lg px-2.5 text-[12.5px] font-medium text-ink transition-colors hover:bg-frame-hover"
              >
                {toast.primary.label}
              </button>
            )}
            <button
              type="button"
              onClick={close}
              aria-label={t("Common", "Close")}
              className={cn(
                "grid size-7 place-items-center rounded-lg text-ink-3 transition-[opacity,color,background-color]",
                "hover:bg-frame-hover hover:text-ink",
                // A toast that expires on its own does not need a permanent
                // close button; one that never expires does.
                sticky ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover/toast:opacity-100",
              )}
            >
              <AppIcon name="x" size={14} strokeWidth={2} />
            </button>
          </div>

          <span
            ref={drainRef}
            aria-hidden
            className={cn(
              "absolute inset-x-0 bottom-0 h-[1.5px] origin-left",
              showsDrain ? "bg-ink/15" : "bg-transparent",
            )}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * The stack lives inside the canvas region, not the window.
 *
 * That is the whole reason it never has to negotiate with the rail, the titlebar
 * or the dock: it is scoped to the one area a module owns, so it can only ever
 * cover a module's own content, and only for a few seconds.
 */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts)
  const [held, setHeld] = useState(false)

  if (!toasts.length) return null

  return (
    <div
      // pointer-events-none on the container, auto on each toast: the empty
      // column above the stack must not swallow clicks meant for the canvas.
      role="region"
      aria-label="Notifications"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center px-4 pb-4"
      style={{ zIndex: Z_LAYERS.toast }}
    >
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} paused={held} />
      ))}
    </div>
  )
}
