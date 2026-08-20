import { lazy, Suspense, type ReactNode } from "react"

import { OverviewRoute } from "@/overview/page/OverviewRoute"

/**
 * How each module's code is fetched.
 *
 * Every page except Overview is loaded on demand. The entry chunk is what the window
 * waits on before it can paint anything, so a module that most launches never open has
 * no business being in it: the notes editor drags in ProseMirror and the mapper, the
 * mindmap its render substrate, Soma react-markdown, and the flashcards pages KaTeX.
 *
 * Overview is deliberately absent: it is DEFAULT_ROUTE, so loading it on demand would
 * put a round trip in front of the most common launch of all.
 *
 * The loaders are separate from the components because app/prefetch.ts warms a chunk
 * before its route is shown. Both sides name one import specifier per module, so a
 * prefetch can never fetch a different chunk from the one the route goes on to render.
 */
const LOAD = {
  notes: () => import("@/notes/page/NotesRoute"),
  // One module, two pages: the gallery and a single map open. They are separate chunks
  // because opening a map from the gallery should not have paid for the gallery again.
  mindmap: () => import("@/mindmap/page/MindmapRoute").then((m) => ({ default: m.MindmapRoute })),
  mindmapLibrary: () =>
    import("@/mindmap/page/MindmapLibraryRoute").then((m) => ({ default: m.MindmapLibraryRoute })),
  soma: () => import("@/chat/components/ChatPage").then((m) => ({ default: m.ChatPage })),
  flashcards: () =>
    import("@/flashcards/library/LibraryPage").then((m) => ({ default: m.LibraryPage })),
  flashcardBrowse: () =>
    import("@/flashcards/browse/BrowsePage").then((m) => ({ default: m.BrowsePage })),
  flashcardDeck: () => import("@/flashcards/deck/DeckPage").then((m) => ({ default: m.DeckPage })),
  flashcardSession: () =>
    import("@/flashcards/session/SessionPage").then((m) => ({ default: m.SessionPage })),
  flashcardTest: () => import("@/flashcards/test/TestPage").then((m) => ({ default: m.TestPage })),
  settings: () => import("@/pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
}

const PAGE = {
  notes: lazy(LOAD.notes),
  mindmap: lazy(LOAD.mindmap),
  mindmapLibrary: lazy(LOAD.mindmapLibrary),
  soma: lazy(LOAD.soma),
  flashcards: lazy(LOAD.flashcards),
  flashcardBrowse: lazy(LOAD.flashcardBrowse),
  flashcardDeck: lazy(LOAD.flashcardDeck),
  flashcardSession: lazy(LOAD.flashcardSession),
  flashcardTest: lazy(LOAD.flashcardTest),
  settings: lazy(LOAD.settings),
}

// Client-side routing: which page renders for a route key. The sidebar model
// (categories, items, order, visibility) is server-sourced - see src/nav.

export const DEFAULT_ROUTE = "overview"

type PageRenderer = (params: readonly string[]) => ReactNode

const PAGES: Record<string, PageRenderer> = {
  overview: () => <OverviewRoute />,
  notes: (p) => (
    <Suspense fallback={<div className="min-h-full" />}>
      <PAGE.notes noteId={p[0]} />
    </Suspense>
  ),
  // One route key, two pages: "#/mindmap" is the gallery and "#/mindmap/{id}" is that map open. A
  // second key would need every link to know which of the two it was pointing at.
  mindmap: (p) =>
    p[0] ? (
      <Suspense fallback={<div className="min-h-full" />}>
        <PAGE.mindmap key={p[0]} mapId={p[0]} />
      </Suspense>
    ) : (
      <Suspense fallback={<div className="min-h-full" />}>
        <PAGE.mindmapLibrary />
      </Suspense>
    ),
  flashcards: () => (
    <Suspense fallback={<div className="min-h-full" />}>
      <PAGE.flashcards />
    </Suspense>
  ),
  "flashcard-browse": () => (
    <Suspense fallback={<div className="min-h-full" />}>
      <PAGE.flashcardBrowse />
    </Suspense>
  ),
  "flashcard-deck": (p) => (
    <Suspense fallback={<div className="min-h-full" />}>
      <PAGE.flashcardDeck deckId={p[0]} />
    </Suspense>
  ),
  "flashcard-session": (p) => (
    <Suspense fallback={<div className="min-h-full" />}>
      <PAGE.flashcardSession deckId={p[0]} mode={p[1]} scope={p[2]} />
    </Suspense>
  ),
  "flashcard-test": (p) => (
    <Suspense fallback={<div className="min-h-full" />}>
      <PAGE.flashcardTest deckId={p[0]} />
    </Suspense>
  ),
  settings: () => (
    <Suspense fallback={<div className="min-h-full" />}>
      <PAGE.settings />
    </Suspense>
  ),
  soma: () => (
    <Suspense fallback={<div className="min-h-full" />}>
      <PAGE.soma />
    </Suspense>
  ),
}

/** Every route key the app knows. */
export const ROUTE_KEYS: readonly string[] = Object.keys(PAGES)

/** The chunk a route key needs, for prefetching. Keys absent here are already loaded. */
const CHUNKS: Record<string, (params: readonly string[]) => Promise<unknown>> = {
  notes: LOAD.notes,
  mindmap: (p) => (p[0] ? LOAD.mindmap() : LOAD.mindmapLibrary()),
  flashcards: LOAD.flashcards,
  "flashcard-browse": LOAD.flashcardBrowse,
  "flashcard-deck": LOAD.flashcardDeck,
  "flashcard-session": LOAD.flashcardSession,
  "flashcard-test": LOAD.flashcardTest,
  settings: LOAD.settings,
  soma: LOAD.soma,
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

/**
 * Which page a location hash names, without building it. Unknown routes come back as
 * the default one, so a wrong hash never blanks the shell.
 */
function matchRoute(hash: string): { key: string; params: readonly string[] } {
  const segments = hash.replace(/^#\/?/, "").split("/").filter(Boolean)
  const raw = segments[0] ?? DEFAULT_ROUTE
  const key = ALIASES[raw] ?? raw
  if (!Object.hasOwn(PAGES, key)) return { key: DEFAULT_ROUTE, params: [] }
  return { key, params: segments.slice(1) }
}

/** Parses a location hash ("#/mindmap/abc") into a resolved route. */
export function resolveRoute(hash: string): ResolvedRoute {
  const { key, params } = matchRoute(hash)
  return { key, params, element: PAGES[key](params) }
}

/**
 * Starts fetching the code a route needs, ahead of anyone going there.
 *
 * Nothing waits on the result: a route that is opened before the fetch lands joins the
 * same import rather than starting a second one, and one that is never opened has cost
 * an idle download. Routes whose code is already in the entry chunk do nothing.
 */
export function warmRoute(hash: string): void {
  const { key, params } = matchRoute(hash)
  if (!Object.hasOwn(CHUNKS, key)) return
  void CHUNKS[key]?.(params)?.catch(() => {
    // A warm that fails is not a failure: the route retries the import when it renders,
    // and that attempt is the one that gets to show the user an error.
  })
}
