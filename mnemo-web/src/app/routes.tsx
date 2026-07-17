import type { ReactNode } from "react"

import { StubPage } from "@/components/shell/StubPage"
import { DecksPage } from "@/pages/DecksPage"
import { SettingsPage } from "@/pages/SettingsPage"

// Sidebar model, mirroring the Avalonia module RegisterSidebarItems groups and
// SidebarService's footer handling: MainHub (Overview, no header), Modules
// (headered), and the footer-rendered Ecosystem (Settings, Assistant). Once
// GET /nav exists this becomes server-sourced. Icon names resolve against the
// ported Mnemo SVGs (src/assets/icons).
export interface NavItemDef {
  route: string
  /** Key in the Sidebar i18n namespace. */
  labelKey: string
  icon: string
  childRoutes?: readonly string[]
  /** Gated by AI.EnableAssistant in the real app; the guard lands with settings/events. */
  requiresAi?: boolean
}

export interface NavCategoryDef {
  key: string
  /** Key in the Sidebar i18n namespace (empty for the header-less hub). */
  labelKey: string
  /** Footer categories render flat at the bottom, with no section header. */
  footer: boolean
  /** The MainHub category suppresses its header (Order 0 in the reference). */
  showHeader: boolean
  items: readonly NavItemDef[]
}

export const NAV_CATEGORIES: readonly NavCategoryDef[] = [
  {
    key: "main",
    labelKey: "MainHub",
    footer: false,
    showHeader: false,
    items: [{ route: "overview", labelKey: "Overview", icon: "sidebar/overview" }],
  },
  {
    key: "modules",
    labelKey: "Modules",
    footer: false,
    showHeader: true,
    items: [
      { route: "notes", labelKey: "Notes", icon: "sidebar/notes" },
      { route: "mindmap", labelKey: "Mindmap", icon: "sidebar/mindmap", childRoutes: ["mindmap-detail"] },
      {
        route: "flashcards",
        labelKey: "Flashcards",
        icon: "sidebar/flashcard",
        childRoutes: ["flashcard-deck", "flashcard-session", "flashcard-test"],
      },
    ],
  },
  {
    key: "ecosystem",
    labelKey: "Ecosystem",
    footer: true,
    showHeader: false,
    items: [
      { route: "settings", labelKey: "Settings", icon: "sidebar/settings" },
      { route: "chat", labelKey: "AIChat", icon: "sidebar/sparkles", requiresAi: true },
    ],
  },
]

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

/** Which sidebar item should read as active for a given route key. */
export function activeNavRoute(routeKey: string): string {
  for (const category of NAV_CATEGORIES) {
    for (const item of category.items) {
      if (item.route === routeKey) return item.route
      if (item.childRoutes?.includes(routeKey)) return item.route
    }
  }
  return routeKey
}

/** The Sidebar i18n key for a route, or null if it is not a top-level nav item. */
export function navLabelKey(routeKey: string): string | null {
  for (const category of NAV_CATEGORIES) {
    for (const item of category.items) {
      if (item.route === routeKey) return item.labelKey
    }
  }
  return null
}
