// @vitest-environment jsdom

/**
 * A render throw in one route stays inside the canvas: the rail is still there, the canvas
 * says what happened, and the route is told to forget what it remembered.
 */

import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AppShell } from "./AppShell"

const mocks = vi.hoisted(() => ({
  forgetRouteMemory: vi.fn(),
  hash: "#/notes/note-that-throws",
}))

function Throws(): never {
  throw new Error("the notes page fell over")
}

vi.mock("@/app/router", () => ({
  useHashRoute: () => mocks.hash,
  navigateTo: vi.fn(),
}))

vi.mock("@/app/routes", () => ({
  DEFAULT_ROUTE: "overview",
  resolveRoute: (hash: string) => ({
    key: hash.startsWith("#/notes") ? "notes" : "overview",
    params: [],
    element: hash.startsWith("#/notes") ? <Throws /> : <p>overview page</p>,
  }),
}))

vi.mock("@/app/route-memory", () => ({ forgetRouteMemory: mocks.forgetRouteMemory }))

vi.mock("@/components/shell/sidebar/Sidebar", () => ({ Sidebar: () => <nav data-testid="rail">rail</nav> }))
vi.mock("@/components/shell/topbar/Topbar", () => ({ Topbar: () => <header>topbar</header> }))
vi.mock("@/components/shell/dock/SomaDock", () => ({ SomaDock: () => null }))
vi.mock("@/components/shell/chrome/ResizeEdges", () => ({ ResizeEdges: () => null }))
vi.mock("@/components/shell/ToastHost", () => ({ ToastHost: () => null }))
vi.mock("@/peek/SidePeek", () => ({ SidePeek: () => null }))

vi.mock("@/nav/store", () => ({
  useNavCategories: () => [],
  activeNavRoute: (_categories: unknown, key: string) => key,
  navItemForRoute: () => null,
}))
vi.mock("@/nav/icons", () => ({ navIcon: () => null }))
vi.mock("@/nav/trail", () => ({ useTrail: () => null }))

vi.mock("@/stores/shell", () => {
  const state = { sidebarCollapsed: false, toggleSidebar: vi.fn(), setSidebarCollapsed: vi.fn() }
  const useShellStore = (selector: (s: typeof state) => unknown) => selector(state)
  useShellStore.getState = () => state
  return { useShellStore }
})

vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string) => key,
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLElement
let root: Root
let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  consoleError.mockRestore()
})

describe("AppShell when a route throws", () => {
  it("keeps the rail and shows the failure on the canvas", () => {
    act(() =>
      root.render(
        <StrictMode>
          <AppShell />
        </StrictMode>,
      ),
    )

    expect(container.querySelector('[data-testid="rail"]')).not.toBeNull()
    expect(container.querySelector("header")?.textContent).toBe("topbar")
    expect(container.querySelector("main")?.textContent).toContain("RouteCrashTitle")
  })

  it("tells the failed route to forget what it remembered", () => {
    act(() =>
      root.render(
        <StrictMode>
          <AppShell />
        </StrictMode>,
      ),
    )

    expect(mocks.forgetRouteMemory).toHaveBeenCalledTimes(1)
    expect(mocks.forgetRouteMemory.mock.calls[0][0]).toBe("notes")
  })
})
