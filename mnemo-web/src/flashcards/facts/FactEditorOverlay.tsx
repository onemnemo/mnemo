import { lazy, Suspense } from "react"
import { createPortal } from "react-dom"

import { Skeleton } from "@/components/ui/skeleton"

import { useCardEditor, type CardEditorTarget } from "../editor/store"

const FactEditor = lazy(() => import("./FactEditor").then((m) => ({ default: m.FactEditor })))

/** Mounted once at the app shell; renders only while the editor store holds a target. */
export function FactEditorOverlay() {
  const target = useCardEditor((state) => state.target)
  const close = useCardEditor((state) => state.close)

  if (!target) return null
  // Keyed on the target so moving from one card to another rebuilds the form rather than leaving
  // the previous card's text in the boxes.
  return (
    <Suspense fallback={<FactEditorShell />}>
      <FactEditor key={targetKey(target)} target={target} onClose={close} />
    </Suspense>
  )
}

function targetKey(target: CardEditorTarget): string {
  return target.kind === "add" ? `add:${target.deckId}` : `edit:${target.cardId}`
}

/**
 * The editor's own chrome with nothing in it yet, shown while its code is still being fetched, so
 * the dialog appears the instant it is asked for rather than leaving the trigger looking dead.
 * Portalled by hand rather than through Radix: there is no dialog primitive mounted until the real
 * content lands, only this placeholder.
 */
function FactEditorShell() {
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/50">
      <div className="fixed left-1/2 top-1/2 z-50 flex max-h-[86vh] w-[724px] max-w-[calc(100vw-3rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-line-soft bg-canvas shadow-pop">
        <div className="flex items-center gap-3.5 border-b border-line-soft px-5 py-3.5">
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3.5 p-5">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </div>
    </div>,
    document.body,
  )
}
