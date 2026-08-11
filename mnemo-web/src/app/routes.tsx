import { lazy, Suspense, type ReactNode } from "react"

import { ChatPage } from "@/chat/components/ChatPage"
import { DeckPage } from "@/flashcards/deck/DeckPage"
import { LibraryPage } from "@/flashcards/library/LibraryPage"
import { SessionPage } from "@/flashcards/session/SessionPage"
import { TestPage } from "@/flashcards/test/TestPage"
import { OverviewRoute } from "@/overview/page/OverviewRoute"
import { SettingsPage } from "@/pages/SettingsPage"

// The notes editor (ProseMirror + mapper + KaTeX) is loaded on demand so its
// ~0.5 MB stays out of the initial bundle, it is needed only on this route.
const NotesRoute = lazy(() => import("@/notes/page/NotesRoute"))

// Same reasoning for the mindmap: the render substrate, the projector and the
// canvas layers are only ever needed once someone opens a map.
const MindmapRoute = lazy(() =>
  import("@/mindmap/page/MindmapRoute").then((m) => ({ default: m.MindmapRoute })),
)
const MindmapLibraryRoute = lazy(() =>
  import("@/mindmap/page/MindmapLibraryRoute").then((m) => ({ default: m.MindmapLibraryRoute })),
)

// Client-side routing: which page renders for a route key. The sidebar model
// (categories, items, order, visibility) is server-sourced - see src/nav.

export const DEFAULT_ROUTE = "overview"

type PageRenderer = (params: readonly string[]) => ReactNode

const PAGES: Record<string, PageRenderer> = {
  overview: () => <OverviewRoute />,
  notes: (p) => (
    <Suspense fallback={<div className="min-h-full" />}>
      <NotesRoute noteId={p[0]} />
    </Suspense>
  ),
  // One route key, two pages: "#/mindmap" is the gallery and "#/mindmap/{id}" is that map open. A
  // second key would need every link to know which of the two it was pointing at.
  mindmap: (p) =>
    p[0] ? (
      <Suspense fallback={<div className="min-h-full" />}>
        <MindmapRoute mapId={p[0]} />
      </Suspense>
    ) : (
      <Suspense fallback={<div className="min-h-full" />}>
        <MindmapLibraryRoute />
      </Suspense>
    ),
  flashcards: () => <LibraryPage />,
  "flashcard-deck": (p) => <DeckPage deckId={p[0]} />,
  "flashcard-session": (p) => <SessionPage deckId={p[0]} mode={p[1]} scope={p[2]} />,
  "flashcard-test": (p) => <TestPage deckId={p[0]} />,
  settings: () => <SettingsPage />,
  soma: () => <ChatPage />,
}

// Routes that were renamed. Kept so a bookmark, a stored last-route or a link in
// an old note still lands somewhere instead of silently falling back to Overview.
const ALIASES: Record<string, string> = {
  chat: "soma",
}

export interface ResolvedRoute {
  key: string
  params: readonly string[]
  element: ReactNode
}

/** Parses a location hash ("#/mindmap/abc") into a resolved route. */
export function resolveRoute(hash: string): ResolvedRoute {
  const segments = hash.replace(/^#\/?/, "").split("/").filter(Boolean)
  const raw = segments[0] ?? DEFAULT_ROUTE
  const key = ALIASES[raw] ?? raw
  const renderer = PAGES[key]
  if (!renderer) {
    return { key: DEFAULT_ROUTE, params: [], element: PAGES[DEFAULT_ROUTE]([]) }
  }
  return { key, params: segments.slice(1), element: renderer(segments.slice(1)) }
}
