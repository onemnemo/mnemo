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

/**
 * Keyboard containment, which a hand-built dialog does not get for free.
 *
 * A dialog Tab can walk out of leaves the reader typing into the page behind a
 * scrim they cannot see past, and one that drops focus on close leaves the next
 * key press going nowhere.
 */
describe("Modal focus", () => {
  function press(key: string, shiftKey = false) {
    act(() => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true }))
    })
  }

  it("wraps Tab around its own controls", () => {
    act(() =>
      root.render(
        <Modal open onClose={() => {}} title="Export" closeLabel="Close">
          <button type="button">First</button>
          <button type="button">Last</button>
        </Modal>,
      ),
    )

    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
    const first = buttons[0]
    const last = buttons[buttons.length - 1]

    act(() => last.focus())
    press("Tab")
    expect(document.activeElement).toBe(first)

    press("Tab", true)
    expect(document.activeElement).toBe(last)
  })

  it("gives focus back to whatever opened it", () => {
    const opener = document.createElement("button")
    document.body.appendChild(opener)
    opener.focus()

    function Host({ open }: { open: boolean }) {
      return (
        <Modal open={open} onClose={() => {}} title="Export" closeLabel="Close">
          <button type="button">Inside</button>
        </Modal>
      )
    }

    act(() => root.render(<Host open />))
    act(() => document.querySelector<HTMLButtonElement>('[role="dialog"] button')?.focus())
    expect(document.activeElement).not.toBe(opener)

    act(() => root.render(<Host open={false} />))
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})
