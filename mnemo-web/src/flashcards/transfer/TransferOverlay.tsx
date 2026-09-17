import { lazy, Suspense } from "react"
import { createPortal } from "react-dom"

import { Skeleton } from "@/components/ui/skeleton"

import { useTransfer } from "./store"

const TransferDialog = lazy(() =>
  import("./TransferDialog").then((m) => ({ default: m.TransferDialog })),
)

/** Mounted once at the app shell; renders only while the store holds a target. */
export function TransferOverlay() {
  const target = useTransfer((state) => state.target)
  const close = useTransfer((state) => state.close)

  if (!target) return null
  return (
    <Suspense fallback={<TransferShell />}>
      <TransferDialog target={target} onClose={close} />
    </Suspense>
  )
}

/**
 * The dialog's own chrome with nothing in it yet, shown while its code is still being fetched, so
 * it appears the instant it is asked for rather than leaving the trigger looking dead. Portalled
 * by hand rather than through Radix: there is no dialog primitive mounted until the real content
 * lands, only this placeholder.
 *
 * Shaped like the dialog's common case, so the chunk landing swaps the contents and not the
 * frame. The body needs a definite height: left to size itself it collapses to its padding.
 */
function TransferShell() {
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/50">
      <div className="fixed left-1/2 top-1/2 z-50 flex max-h-[86vh] w-[520px] max-w-[calc(100vw-3rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-line bg-[var(--overlay-background)] shadow-[0_16px_40px_0_rgba(0,0,0,0.22)]">
        <div className="flex items-center gap-3 border-b border-divider-subtle px-5 py-3.5">
          <Skeleton className="h-4 w-32" />
          <div className="flex-1" />
          <Skeleton className="h-8 w-[176px] rounded-lg" />
          <Skeleton className="size-7 shrink-0 rounded-md" />
        </div>
        <div className="shrink-0 px-5 py-[18px]">
          <Skeleton className="h-[152px] w-full rounded-lg" />
        </div>
        <div className="flex shrink-0 items-center gap-3 border-t border-divider-subtle px-5 py-3.5">
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-[34px] w-20" />
          <Skeleton className="h-[34px] w-24" />
        </div>
      </div>
    </div>,
    document.body,
  )
}
