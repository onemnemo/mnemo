import { lazy, Suspense } from "react"
import { createPortal } from "react-dom"

import { Skeleton } from "@/components/ui/skeleton"

import { useReviewSettings } from "./store"

const ReviewSettings = lazy(() =>
  import("./ReviewSettings").then((m) => ({ default: m.ReviewSettings })),
)

/** Mounted once at the app shell; renders only while the store holds a target. */
export function ReviewSettingsOverlay() {
  const target = useReviewSettings((state) => state.target)
  const close = useReviewSettings((state) => state.close)

  if (!target) return null
  // Keyed on the deck so reopening from a different deck rebuilds the drafts rather than
  // leaving the previous deck's selection in place.
  return (
    <Suspense fallback={<ReviewSettingsShell />}>
      <ReviewSettings key={target.deckId ?? "no-deck"} target={target} onClose={close} />
    </Suspense>
  )
}

/**
 * The dialog's own chrome with nothing in it yet, shown while its code is still being fetched, so
 * it appears the instant it is asked for rather than leaving the trigger looking dead. Portalled
 * by hand rather than through Radix: there is no dialog primitive mounted until the real content
 * lands, only this placeholder.
 */
function ReviewSettingsShell() {
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/50">
      <div className="fixed left-1/2 top-1/2 z-50 flex max-h-[86vh] w-[856px] max-w-[calc(100vw-3rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-line-soft bg-canvas shadow-pop">
        <div className="flex items-start gap-3.5 border-b border-line-soft px-5 py-3.5">
          <Skeleton className="h-4 w-40" />
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
