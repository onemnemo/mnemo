// @vitest-environment jsdom

/**
 * A route that throws costs the user that route, not the shell. The boundary sits between
 * the chrome and the canvas: the failure stays inside it, the route it was told about is
 * asked to forget what it remembered, and the next navigation gets a fresh mount.
 */

import { act, StrictMode, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { RouteErrorBoundary } from "./RouteErrorBoundary"

vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string) => key,
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLElement
let root: Root
let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  // React reports a caught error on the console as well; the boundary logs it once more
  // with the route. Neither is the test's concern.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  consoleError.mockRestore()
})

function Throws(): ReactNode {
  throw new Error("the deck page fell over")
}

function mount(node: ReactNode): void {
  act(() => root.render(<StrictMode>{node}</StrictMode>))
}

describe("RouteErrorBoundary", () => {
  it("keeps a route's failure inside the canvas", () => {
    mount(
      <div>
        <nav>sidebar</nav>
        <RouteErrorBoundary hash="#/flashcards/deck-1" routeKey="flashcard-deck">
          <Throws />
        </RouteErrorBoundary>
      </div>,
    )

    expect(container.querySelector("nav")?.textContent).toBe("sidebar")
    expect(container.textContent).toContain("RouteCrashTitle")
    expect(container.textContent).toContain("RouteCrashHint")
  })

  it("tells the shell which route failed", () => {
    const onCatch = vi.fn()
    mount(
      <RouteErrorBoundary hash="#/notes/abc" routeKey="notes" onCatch={onCatch}>
        <Throws />
      </RouteErrorBoundary>,
    )

    expect(onCatch).toHaveBeenCalledTimes(1)
    expect(onCatch.mock.calls[0][0]).toBe("notes")
    expect((onCatch.mock.calls[0][1] as Error).message).toBe("the deck page fell over")
  })

  it("drops the failure when the hash changes and mounts the new route", () => {
    mount(
      <RouteErrorBoundary hash="#/flashcards/deck-1" routeKey="flashcard-deck">
        <Throws />
      </RouteErrorBoundary>,
    )
    expect(container.textContent).toContain("RouteCrashTitle")

    mount(
      <RouteErrorBoundary hash="#/overview" routeKey="overview">
        <p>overview</p>
      </RouteErrorBoundary>,
    )

    expect(container.textContent).toBe("overview")
  })

  it("keeps the panel while the hash stays the same", () => {
    mount(
      <RouteErrorBoundary hash="#/flashcards/deck-1" routeKey="flashcard-deck">
        <Throws />
      </RouteErrorBoundary>,
    )

    mount(
      <RouteErrorBoundary hash="#/flashcards/deck-1" routeKey="flashcard-deck">
        <p>would throw again</p>
      </RouteErrorBoundary>,
    )

    expect(container.textContent).toContain("RouteCrashTitle")
    expect(container.textContent).not.toContain("would throw again")
  })

  it("renders its children when nothing throws", () => {
    mount(
      <RouteErrorBoundary hash="#/overview" routeKey="overview">
        <p>overview</p>
      </RouteErrorBoundary>,
    )

    expect(container.textContent).toBe("overview")
  })

  it("returns to the overview by navigating, or by a reset and a reload when the overview is what failed", () => {
    // A location double, because jsdom does not implement reload and a same-fragment hash
    // assignment is the case under test.
    const reload = vi.fn()
    const stub: Record<string, unknown> = { ...window.location, hash: "#/flashcards/deck-1", reload }
    stub.replace = (url: string) => {
      stub.hash = url
    }
    vi.stubGlobal("location", stub)
    localStorage.setItem("mnemo.last-route", "#/flashcards/deck-1")
    try {
      mount(
        <RouteErrorBoundary hash="#/flashcards/deck-1" routeKey="flashcard-deck">
          <Throws />
        </RouteErrorBoundary>,
      )
      const overview = () => [...container.querySelectorAll("button")].find((el) => el.textContent === "CrashReturnToOverview")!
      act(() => overview().click())
      expect(stub.hash).toBe("#/overview")
      expect(reload).not.toHaveBeenCalled()

      // The overview itself failed: the hash cannot change, so the memory is cleared and the
      // window reloaded, the way the whole-window crash screen does it.
      mount(
        <RouteErrorBoundary hash="#/overview" routeKey="overview">
          <Throws />
        </RouteErrorBoundary>,
      )
      act(() => overview().click())
      expect(reload).toHaveBeenCalledTimes(1)
      expect(localStorage.getItem("mnemo.last-route")).toBeNull()
    } finally {
      vi.unstubAllGlobals()
      localStorage.clear()
    }
  })

  it("offers the details on request", () => {
    mount(
      <RouteErrorBoundary hash="#/flashcards/deck-1" routeKey="flashcard-deck">
        <Throws />
      </RouteErrorBoundary>,
    )

    const toggle = [...container.querySelectorAll("button")].find((el) => el.textContent === "CrashShowDetails")
    expect(toggle).toBeDefined()
    act(() => toggle!.click())

    expect(container.querySelector("pre")?.textContent).toContain("the deck page fell over")
  })
})
