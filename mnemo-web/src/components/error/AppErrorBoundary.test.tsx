// @vitest-environment jsdom

/**
 * Checks crash handling, diagnostics, and recovery actions. React error output is suppressed for
 * the expected crashes.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AppErrorBoundary } from "./AppErrorBoundary"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Boom(): never {
  throw new Error("boom in notes")
}

let container: HTMLElement
let root: Root
let reload: ReturnType<typeof vi.fn>

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)

  localStorage.clear()

  // Use a location double because jsdom does not implement reload. History replacement is tested
  // against the real Location in router.test.ts.
  reload = vi.fn()
  const stub: Record<string, unknown> = {
    ...window.location,
    hash: "#/notes/crashing-note",
    reload,
  }
  stub.replace = (url: string) => {
    stub.hash = url
  }
  vi.stubGlobal("location", stub)

  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function mountCrashingTree(): void {
  act(() => {
    root.render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    )
  })
}

function buttonWithText(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((b) => b.textContent === text) as
    | HTMLButtonElement
    | undefined
}

describe("AppErrorBoundary", () => {
  it("replaces the crashing tree with the crash screen and records the active hash", () => {
    mountCrashingTree()

    expect(container.querySelector("h1")?.textContent).toBe("CrashTitle")

    const calls = (console.error as unknown as ReturnType<typeof vi.fn>).mock.calls
    const recorded = calls.find(
      (args) => typeof args[0] === "string" && args[0].includes("root boundary"),
    )
    expect(recorded?.[0]).toContain("#/notes/crashing-note")
  })

  it("the return-to-overview action clears the remembered route and reloads into it", () => {
    localStorage.setItem("mnemo.last-route", "#/notes/crashing-note")
    mountCrashingTree()

    const button = buttonWithText("CrashReturnToOverview")
    expect(button).toBeDefined()

    act(() => button!.click())

    expect(localStorage.getItem("mnemo.last-route")).toBeNull()
    expect(window.location.hash).toBe("#/overview")
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it("leaves the stored route untouched by plain reload, which is exactly the loop this fixes", () => {
    localStorage.setItem("mnemo.last-route", "#/notes/crashing-note")
    mountCrashingTree()

    const button = buttonWithText("CrashReload")
    act(() => button!.click())

    expect(localStorage.getItem("mnemo.last-route")).toBe("#/notes/crashing-note")
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it("makes the shown stack selectable under the app's selection-ownership rule", () => {
    const style = document.createElement("style")
    // Mirrors the app-wide rule in index.css: everything defaults to unselectable, and
    // data-selectable opts an element (and its descendants) back in.
    style.textContent = `
      * { user-select: none; }
      [data-selectable], [data-selectable] * { user-select: text; }
    `
    document.head.appendChild(style)

    try {
      mountCrashingTree()

      const showDetails = buttonWithText("CrashShowDetails")
      act(() => showDetails!.click())

      const pre = container.querySelector("pre")
      expect(pre).not.toBeNull()
      expect(pre?.hasAttribute("data-selectable")).toBe(true)
      expect(getComputedStyle(pre!).userSelect).toBe("text")

      // A neighboring element verifies that selection comes from the explicit opt-in.
      const title = container.querySelector("h1")
      expect(getComputedStyle(title!).userSelect).toBe("none")
    } finally {
      style.remove()
    }
  })
})
