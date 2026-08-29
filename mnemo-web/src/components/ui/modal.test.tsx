// @vitest-environment jsdom


import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { Z_LAYERS } from "@/lib/z-layers"

import { Modal } from "./modal"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

describe("Modal stacking", () => {
  it("sits at the layer the shared order gives it", () => {
    act(() =>
      root.render(
        <Modal open onClose={() => {}} title="Export" closeLabel="Close">
          content
        </Modal>,
      ),
    )

    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog, "the modal did not mount").not.toBeNull()
    expect((dialog!.parentElement as HTMLElement).style.zIndex).toBe(String(Z_LAYERS.modal))
  })
})
