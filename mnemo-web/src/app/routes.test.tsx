// @vitest-environment jsdom

/**
 * That every route key still renders its own page.
 *
 * All but the landing route are loaded on demand, so the table holds an import specifier
 * per key rather than a component the compiler checked. A key pointed at the wrong module,
 * or at one whose export was since renamed, typechecks and builds exactly the same; it
 * fails when somebody navigates there, as a canvas that never fills. Walking the whole
 * table here is what makes that a failing test instead of a bug report.
 *
 * The pages themselves are stubbed. What is under test is the wiring, and mounting ten
 * real modules would only prove that they each need a query client.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DEFAULT_ROUTE, ROUTE_KEYS, resolveRoute, warmRoute } from "./routes"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/overview/page/OverviewRoute", () => ({
  OverviewRoute: () => <div data-page="overview" />,
}))
vi.mock("@/notes/page/NotesRoute", () => ({ default: () => <div data-page="notes" /> }))
vi.mock("@/mindmap/page/MindmapRoute", () => ({
  MindmapRoute: () => <div data-page="mindmap" />,
}))
vi.mock("@/mindmap/page/MindmapLibraryRoute", () => ({
  MindmapLibraryRoute: () => <div data-page="mindmap-library" />,
}))
vi.mock("@/chat/components/ChatPage", () => ({ ChatPage: () => <div data-page="soma" /> }))
vi.mock("@/flashcards/library/LibraryPage", () => ({
  LibraryPage: () => <div data-page="flashcards" />,
}))
vi.mock("@/flashcards/browse/BrowsePage", () => ({
  BrowsePage: () => <div data-page="flashcard-browse" />,
}))
vi.mock("@/flashcards/deck/DeckPage", () => ({
  DeckPage: () => <div data-page="flashcard-deck" />,
}))
vi.mock("@/flashcards/session/SessionPage", () => ({
  SessionPage: () => <div data-page="flashcard-session" />,
}))
vi.mock("@/flashcards/test/TestPage", () => ({
  TestPage: () => <div data-page="flashcard-test" />,
}))
vi.mock("@/pages/SettingsPage", () => ({ SettingsPage: () => <div data-page="settings" /> }))

interface RouteCase {
  /** The hash as the address bar would hold it, params and all. */
  hash: string
  /** The key it must resolve to. */
  key: string
  /** The stub that must end up on screen. */
  page: string
  /** Whether the page is fetched on demand, and so arrives behind a fallback. */
  deferred: boolean
}

// "#/mindmap" appears twice on purpose: one key, two pages, and which of them you get is
// the only thing the parameter decides.
const ROUTES: readonly RouteCase[] = [
  { hash: "#/overview", key: "overview", page: "overview", deferred: false },
  { hash: "#/notes", key: "notes", page: "notes", deferred: true },
  { hash: "#/mindmap", key: "mindmap", page: "mindmap-library", deferred: true },
  { hash: "#/mindmap/abc", key: "mindmap", page: "mindmap", deferred: true },
  { hash: "#/flashcards", key: "flashcards", page: "flashcards", deferred: true },
  {
    hash: "#/flashcard-browse",
    key: "flashcard-browse",
    page: "flashcard-browse",
    deferred: true,
  },
  { hash: "#/flashcard-deck/d1", key: "flashcard-deck", page: "flashcard-deck", deferred: true },
  {
    hash: "#/flashcard-session/d1/review/due",
    key: "flashcard-session",
    page: "flashcard-session",
    deferred: true,
  },
  { hash: "#/flashcard-test/d1", key: "flashcard-test", page: "flashcard-test", deferred: true },
  { hash: "#/settings", key: "settings", page: "settings", deferred: true },
  { hash: "#/soma", key: "soma", page: "soma", deferred: true },
]

let container: HTMLElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("resolveRoute", () => {
  it("covers every key in the route table", () => {
    // Guards the suite rather than the app: a route added without a case here would
    // otherwise be shipped by a green run that never rendered it.
    expect(new Set(ROUTES.map((route) => route.key))).toEqual(new Set(ROUTE_KEYS))
  })

  it.each(ROUTES)("renders the $page page for $hash", async ({ hash, key, page, deferred }) => {
    const resolved = resolveRoute(hash)
    expect(resolved.key).toBe(key)

    act(() => root.render(resolved.element))

    if (deferred) {
      // This is each page's first render in this file, so its chunk is genuinely still in
      // flight and what is on screen is the fallback the route wrapped it in. Asserting it
      // here rather than once, elsewhere, is deliberate: React caches a resolved lazy
      // component, so any later render of the same page would never suspend again.
      expect(container.querySelector(`[data-page="${page}"]`)).toBeNull()
      // Full height, so the canvas keeps its size and the page does not arrive into a
      // collapsed frame.
      expect(container.querySelector("div.min-h-full")).not.toBeNull()
    }

    await act(async () => {})

    expect(container.querySelector(`[data-page="${page}"]`)).not.toBeNull()
  })

  it("hands the path segments to the page as parameters", () => {
    expect(resolveRoute("#/flashcard-session/d1/review/due").params).toEqual([
      "d1",
      "review",
      "due",
    ])
  })

  it("resolves a renamed route through its alias", () => {
    expect(resolveRoute("#/chat").key).toBe("soma")
  })

  it("falls back to the landing route for a hash naming nothing", () => {
    const resolved = resolveRoute("#/there-is-no-such-page/42")

    expect(resolved.key).toBe(DEFAULT_ROUTE)
    // Dropped rather than carried across: they were addressed to a different page.
    expect(resolved.params).toEqual([])
  })

  // `PAGES` is a plain object, so a segment naming an inherited Object.prototype
  // property (`constructor`, `__proto__`, `toString`, ...) reads as present through
  // a bare `PAGES[key]` lookup even though nobody ever registered that route. The
  // guard has to ask whether the key is the table's own, not merely truthy.
  it.each(["#/constructor", "#/__proto__", "#/toString"])(
    "falls back to the landing route for the inherited property %s",
    (hash) => {
      const resolved = resolveRoute(hash)
      expect(resolved.key).toBe(DEFAULT_ROUTE)
      expect(resolved.params).toEqual([])
    },
  )
})

describe("warmRoute", () => {
  // The same inherited-property keys, through the idle prefetch. `warmRoute` asks
  // `Object.hasOwn(CHUNKS, key)` itself rather than only trusting that whatever
  // `matchRoute` returned is already safe to index with, so the prefetch stays
  // correct on its own terms. An inherited key that reached an unguarded
  // `CHUNKS[key]` would resolve to a builtin such as `Object` or
  // `Object.prototype.toString`, which is callable but returns something with no
  // `.catch`, so the following optional chain would throw a TypeError
  // synchronously, inside the idle callback, the moment such a key got that far.
  it.each(["#/constructor", "#/__proto__", "#/toString"])(
    "prefetches nothing for the inherited property %s",
    (hash) => {
      expect(() => warmRoute(hash)).not.toThrow()
    },
  )
})

describe("loading", () => {
  it("renders the landing route without a fetch at all", () => {
    // Overview is the default route, so it stays in the entry chunk. Making it lazy would
    // buy nothing and would put a round trip in front of the most common launch there is.
    act(() => root.render(resolveRoute(`#/${DEFAULT_ROUTE}`).element))

    expect(container.querySelector('[data-page="overview"]')).not.toBeNull()
    expect(container.querySelector("div.min-h-full")).toBeNull()
  })
})
