// @vitest-environment jsdom


import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { Z_LAYERS } from "@/lib/z-layers"
import { type ToastType, useToastStore } from "@/stores/toast"

import { ToastHost } from "./ToastHost"

vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string) => key,
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom lacks the animation methods used by ToastRow cleanup.
const fakeAnimation = { finished: Promise.resolve(), cancel() {}, pause() {}, play() {} } as unknown as Animation
Element.prototype.animate = (() => fakeAnimation) as unknown as typeof Element.prototype.animate
Element.prototype.getAnimations = (() => [fakeAnimation]) as unknown as typeof Element.prototype.getAnimations

let container: HTMLElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  useToastStore.setState({ toasts: [], history: [] })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("ToastHost stacking", () => {
  it("sits at the layer the shared order gives it", () => {
    useToastStore.setState({
      toasts: [{ id: "1", type: "info", title: "Saved", durationMs: 0, createdAt: Date.now(), revision: 0 }],
    })

    act(() => root.render(<ToastHost />))

    const region = container.querySelector<HTMLElement>('[role="region"]')
    expect(region, "the toast stack is not on screen").not.toBeNull()
    expect(region!.style.zIndex).toBe(String(Z_LAYERS.toast))
  })

  it("shows ongoing work with a persistent spinner", () => {
    useToastStore.setState({
      toasts: [
        {
          id: "1",
          type: "progress",
          title: "Backing up",
          durationMs: 0,
          createdAt: Date.now(),
          revision: 0,
        },
      ],
    })

    act(() => root.render(<ToastHost />))

    expect(container.querySelector("svg")?.classList.contains("animate-spin")).toBe(true)
    expect(container.querySelector("button")?.classList.contains("opacity-100")).toBe(true)
  })

  it("renders an unknown host type as an information toast", () => {
    useToastStore.setState({
      toasts: [
        {
          id: "1",
          type: "task" as ToastType,
          title: "Older host event",
          durationMs: 0,
          createdAt: Date.now(),
          revision: 0,
        },
      ],
    })

    act(() => root.render(<ToastHost />))

    const status = container.querySelector('[role="status"]')
    expect(status).not.toBeNull()
    expect(status?.firstElementChild?.querySelector("svg")).toBeNull()
  })
})
