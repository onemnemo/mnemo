import { lazy, Suspense } from "react"

import { cn } from "@/lib/utils"

import type { PeekItem } from "./store"

// Every renderer is loaded on demand, for the reason the routes are: the panel is frame
// furniture mounted on every route, and importing the note renderer statically here
// would put ProseMirror and the mapper in the entry chunk no matter how the notes route
// imports them. A module is only split when every importer is dynamic.
const NotePeek = lazy(() => import("./renderers/NotePeek").then((m) => ({ default: m.NotePeek })))
const CardPeekPane = lazy(() =>
  import("./renderers/CardPeekPane").then((m) => ({ default: m.CardPeekPane })),
)
const MindmapPeek = lazy(() =>
  import("./renderers/MindmapPeek").then((m) => ({ default: m.MindmapPeek })),
)
const SomaPeek = lazy(() => import("./renderers/SomaPeek").then((m) => ({ default: m.SomaPeek })))

/** Surfaces that manage their own scrolling and pinned chrome. */
function ownsScroll(item: PeekItem): boolean {
  return item.kind === "soma"
}

export function PeekBody({ item, refresh }: { item: PeekItem; refresh: number }) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        ownsScroll(item) ? "overflow-hidden" : "scroll-thin overflow-y-auto",
      )}
    >
      <Suspense fallback={<div className="min-h-0 flex-1" />}>{renderItem(item, refresh)}</Suspense>
    </div>
  )
}

function renderItem(item: PeekItem, refresh: number) {
  switch (item.kind) {
    case "note":
      return <NotePeek noteId={item.id} refresh={refresh} />
    case "card":
      return <CardPeekPane view={item.view} />
    case "mindmap":
      return <MindmapPeek mapId={item.id} />
    case "soma":
      return <SomaPeek />
  }
}
