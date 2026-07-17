import type { ReactNode } from "react"

import { StubPage } from "@/components/shell/StubPage"
import { DecksPage } from "@/pages/DecksPage"
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
  flashcards: () => <DecksPage />,
  "flashcard-deck": (p) => <StubPage title="Deck" subtitle={p[0]} />,
  "flashcard-session": (p) => <StubPage title="Study session" subtitle={p[0]} />,
  "flashcard-test": (p) => <StubPage title="Test" subtitle={p[0]} />,
  settings: () => <SettingsPage />,
  chat: () => <StubPage title="Assistant" />,
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
