import { lazy, Suspense } from "react"
import { createPortal } from "react-dom"

import { Skeleton } from "@/components/ui/skeleton"

import { useCardTypeManager } from "./store"

const CardTypeManager = lazy(() =>
  import("./CardTypeManager").then((m) => ({ default: m.CardTypeManager })),
)

/** Mounted once at the app shell; renders only while the manager is open. */
export function CardTypeOverlay() {
  const open = useCardTypeManager((state) => state.open)
  const initialTypeId = useCardTypeManager((state) => state.initialTypeId)
  const close = useCardTypeManager((state) => state.close)

  if (!open) return null
  // Keyed on the type it opened for, so reopening starts from the stored types again rather than
  // from edits that were closed away from.
  return (
    <Suspense fallback={<CardTypeManagerShell />}>
      <CardTypeManager key={initialTypeId ?? "all"} initialTypeId={initialTypeId} onClose={close} />
    </Suspense>
  )
}

/**
 * The manager's own chrome with nothing in it yet, shown while its code is still being fetched, so
 * the dialog appears the instant it is asked for rather than leaving the trigger looking dead.
 * Portalled by hand rather than through Radix: there is no dialog primitive mounted until the real
 * content lands, only this placeholder.
 *
 * Sized to the geometry the manager first paints, so the chunk landing swaps the contents and not
 * the frame. The body needs a definite height: left to size itself it collapses to its padding.
 */
function CardTypeManagerShell() {
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/50">
      <div className="fixed left-1/2 top-1/2 z-50 flex max-h-[86vh] w-[880px] max-w-[calc(100vw-3rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-line-soft bg-canvas shadow-pop">
        <div className="flex items-start gap-3.5 border-b border-line-soft px-5 py-3.5">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-3 w-72" />
          </div>
          <Skeleton className="size-7 shrink-0 rounded-md" />
        </div>
        <div className="flex h-[420px] shrink-0 gap-4 p-5">
          <Skeleton className="h-full w-[200px] shrink-0" />
          <Skeleton className="h-full flex-1" />
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t border-line-soft px-5 py-3">
          <Skeleton className="h-3 w-56" />
          <div className="flex-1" />
          <Skeleton className="h-[34px] w-20" />
          <Skeleton className="h-[34px] w-[72px]" />
        </div>
      </div>
    </div>,
    document.body,
  )
}
