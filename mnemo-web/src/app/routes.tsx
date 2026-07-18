import type { ReactNode } from "react"

import { ChatPage } from "@/chat/components/ChatPage"
import { StubPage } from "@/components/shell/StubPage"
import { DeckPage } from "@/flashcards/deck/DeckPage"
import { LibraryPage } from "@/flashcards/library/LibraryPage"
import { SessionPage } from "@/flashcards/session/SessionPage"
import { TestPage } from "@/flashcards/test/TestPage"
import { SettingsPage } from "@/pages/SettingsPage"

// Client-side routing: which page renders for a route key. The sidebar model
// (categories, items, order, visibility) is server-sourced - see src/nav.

export const DEFAULT_ROUTE = "overview"

type PageRenderer = (params: readonly string[]) => ReactNode

const PAGES: Record<string, PageRenderer> = {
  overview: () => <StubPage title="Overview" />,
  notes: (p) => <StubPage title="Notes" subtitle={p[0] ? `Note ${p[0]}` : undefined} />,
  mindmap: () => <StubPage title="Mindmaps" />,
  "mindmap-detail": (p) => <StubPage title="Mindmap" subtitle={p[0] ? `Map ${p[0]}` : undefined} />,
  flashcards: () => <LibraryPage />,
  "flashcard-deck": (p) => <DeckPage deckId={p[0]} />,
  "flashcard-session": (p) => <SessionPage deckId={p[0]} mode={p[1]} scope={p[2]} />,
  "flashcard-test": (p) => <TestPage deckId={p[0]} />,
  settings: () => <SettingsPage />,
  chat: () => <ChatPage />,
}

export interface ResolvedRoute {
  key: string
  params: readonly string[]
  element: ReactNode
}

/** Parses a location hash ("#/mindmap/abc") into a resolved route. */
export function resolveRoute(hash: string): ResolvedRoute {
  const segments = hash.replace(/^#\/?/, "").split("/").filter(Boolean)
  const key = segments[0] ?? DEFAULT_ROUTE
  const renderer = PAGES[key]
  if (!renderer) {
    return { key: DEFAULT_ROUTE, params: [], element: PAGES[DEFAULT_ROUTE]([]) }
  }
  return { key, params: segments.slice(1), element: renderer(segments.slice(1)) }
}
