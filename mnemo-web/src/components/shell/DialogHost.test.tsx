// @vitest-environment jsdom

/**
 * Checks that queued dialogs use the shared portal and stacking order. Actual painting requires
 * browser verification.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { useDialogStore } from "@/stores/dialog"

import { DialogHost } from "./DialogHost"
import { getTopLayer } from "./top-layer"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  useDialogStore.setState({ queue: [] })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("DialogHost layering", () => {
  it("portals an open confirm into the shared top layer", () => {
    act(() => root.render(<DialogHost />))

    act(() => {
      void useDialogStore.getState().confirm({ title: "Quit Mnemo?" })
    })

    const content = document.querySelector('[role="dialog"]')
    expect(content, "the confirm dialog did not mount").not.toBeNull()
    expect(getTopLayer().contains(content)).toBe(true)
  })
})

describe("DialogHost initial focus", () => {
  const focused = () => document.activeElement?.textContent

  it("focuses the confirm button by default", () => {
    act(() => root.render(<DialogHost />))
    act(() => {
      void useDialogStore.getState().confirm({ title: "Quit?", confirmLabel: "Quit", cancelLabel: "Stay" })
    })

    expect(focused()).toBe("Quit")
  })

  it("focuses Cancel when the request asks for it", () => {
    act(() => root.render(<DialogHost />))
    act(() => {
      void useDialogStore.getState().confirm({
        title: "Move cards to the trash?",
        confirmLabel: "Save anyway",
        cancelLabel: "Cancel",
        destructive: true,
        initialFocus: "cancel",
      })
    })

    expect(focused()).toBe("Cancel")
  })
})
