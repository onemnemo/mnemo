import { LayoutDashboard, Layers, NotebookText, Settings, Sparkles, Waypoints, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

import { StubPage } from "@/components/shell/StubPage"
import { DecksPage } from "@/pages/DecksPage"

// The sidebar nav, mirroring the Avalonia module RegisterSidebarItems groups
// (MainHub / Modules / Ecosystem). `childRoutes` keep the parent highlighted
// while a deep route is open. Once GET /nav exists this becomes server-sourced.
export interface NavItem {
  route: string
  label: string
  icon: LucideIcon
  childRoutes?: readonly string[]
}

export interface NavGroup {
  id: string
  label?: string
  items: readonly NavItem[]
}

export const NAV_GROUPS: readonly NavGroup[] = [
  { id: "main", items: [{ route: "overview", label: "Overview", icon: LayoutDashboard }] },
  {
    id: "modules",
    label: "Modules",
    items: [
      { route: "notes", label: "Notes", icon: NotebookText },
      { route: "mindmap", label: "Mindmaps", icon: Waypoints, childRoutes: ["mindmap-detail"] },
      {
        route: "flashcards",
        label: "Flashcards",
        icon: Layers,
        childRoutes: ["flashcard-deck", "flashcard-session", "flashcard-test"],
      },
    ],
  },
  {
    id: "ecosystem",
    items: [
      { route: "settings", label: "Settings", icon: Settings },
      // Route is gated by AI.EnableAssistant in the real app; the guard lands
      // when the settings/events plumbing does.
      { route: "chat", label: "Assistant", icon: Sparkles },
    ],
  },
]

export const DEFAULT_ROUTE = "overview"

// route key -> renderer, receiving any remaining hash segments as params.
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
  settings: () => <StubPage title="Settings" />,
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
  const params = segments.slice(1)
  return { key, params, element: renderer(params) }
}

/** Which sidebar item should read as active for a given route key. */
export function activeNavRoute(routeKey: string): string {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (item.route === routeKey) return item.route
      if (item.childRoutes?.includes(routeKey)) return item.route
    }
  }
  return routeKey
}
