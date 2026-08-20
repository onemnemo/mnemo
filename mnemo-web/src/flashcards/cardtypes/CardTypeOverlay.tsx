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
 */
function CardTypeManagerShell() {
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/50">
      <div className="fixed left-1/2 top-1/2 z-50 flex h-[86vh] w-[880px] max-w-[calc(100vw-3rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-line-soft bg-canvas shadow-pop">
        <div className="flex items-center gap-3.5 border-b border-line-soft px-5 py-3.5">
          <Skeleton className="h-4 w-44" />
        </div>
        <div className="flex min-h-0 flex-1 gap-4 p-5">
          <Skeleton className="h-full w-[200px] shrink-0" />
          <Skeleton className="h-full flex-1" />
        </div>
      </div>
    </div>,
    document.body,
  )
}
