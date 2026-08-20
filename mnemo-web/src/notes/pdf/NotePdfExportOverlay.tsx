import { lazy, Suspense } from "react"
import { createPortal } from "react-dom"

import { Skeleton } from "@/components/ui/skeleton"

import { useNotePdf } from "./store"

const NotePdfExport = lazy(() =>
  import("./NotePdfExport").then((m) => ({ default: m.NotePdfExport })),
)

/** Mounted once in the notes workspace; renders only while the store holds a target. */
export function NotePdfExportOverlay() {
  const target = useNotePdf((state) => state.target)
  const close = useNotePdf((state) => state.close)

  if (!target) return null
  // Keyed so every open starts on the defaults rather than on whatever the last note was set to:
  // page setup is a property of the document being exported, not of the app.
  return (
    <Suspense fallback={<NotePdfExportShell />}>
      <NotePdfExport key={target.noteId} target={target} onClose={close} />
    </Suspense>
  )
}

/**
 * The dialog's own chrome with nothing in it yet, shown while its code (and pdf.js, the reason
 * this overlay is split off on its own) is still being fetched, so the dialog appears the instant
 * export is asked for rather than leaving the trigger looking dead. Sized and positioned like the
 * real `Modal` it stands in for, portalled the same way, but built by hand rather than mounting
 * `Modal` itself: that component requires real title text, and there is nothing worth saying yet.
 */
function NotePdfExportShell() {
  return createPortal(
    <div className="animate-fade-in fixed inset-0 z-[140] flex items-center justify-center p-8">
      <div className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]" />
      <div
        style={{ width: 960, maxHeight: "min(820px, 92vh)" }}
        className="animate-pop-in relative flex max-w-full flex-col overflow-hidden rounded-2xl bg-canvas shadow-pop"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-4">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="size-7 shrink-0 rounded-md" />
        </header>
        <div className="flex min-h-0 flex-1 gap-4 px-5">
          <Skeleton className="h-full w-[336px] shrink-0" />
          <Skeleton className="h-full flex-1" />
        </div>
        <footer className="flex shrink-0 items-center gap-3 px-5 py-3">
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-9 w-20" />
        </footer>
      </div>
    </div>,
    document.body,
  )
}
