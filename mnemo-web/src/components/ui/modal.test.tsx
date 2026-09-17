// @vitest-environment jsdom

import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { DialogHost } from "@/components/shell/DialogHost"
import { Z_LAYERS } from "@/lib/z-layers"
import { useDialogStore } from "@/stores/dialog"

import { Modal } from "./modal"

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

describe("Modal focus", () => {
  it("moves focus to its first control on open, and back to the opener on close", () => {
    const opener = document.createElement("button")
    document.body.appendChild(opener)
    opener.focus()

    act(() =>
      root.render(
        <StrictMode>
          <Modal open onClose={() => {}} title="Export" closeLabel="Close">
            <input aria-label="Name" />
          </Modal>
        </StrictMode>,
      ),
    )
    expect((document.activeElement as HTMLElement | null)?.getAttribute("aria-label")).toBe("Close")

    act(() => root.render(null))
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it("takes focus itself when it has nothing to give it to", () => {
    act(() =>
      root.render(
        <StrictMode>
          <Modal open onClose={() => {}} title="Export" closeLabel="Close">
            plain text
          </Modal>
        </StrictMode>,
      ),
    )
    // The close button is a control, so the surface is only the fallback once it is gone
    // from the tab order; what matters is that focus is inside the dialog at all.
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.contains(document.activeElement)).toBe(true)
  })
})

describe("Modal stacking", () => {
  it("sits at the layer the shared order gives it", () => {
    act(() =>
      root.render(
        <StrictMode>
          <Modal open onClose={() => {}} title="Export" closeLabel="Close">
            content
          </Modal>
        </StrictMode>,
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
        <StrictMode>
          <Modal open onClose={() => {}} title="Export" closeLabel="Close">
            <button type="button">First</button>
            <button type="button">Last</button>
          </Modal>
        </StrictMode>,
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

    act(() => root.render(<StrictMode><Host open /></StrictMode>))
    act(() => document.querySelector<HTMLButtonElement>('[role="dialog"] button')?.focus())
    expect(document.activeElement).not.toBe(opener)

    act(() => root.render(<StrictMode><Host open={false} /></StrictMode>))
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})

describe("Modal escape", () => {
  function escape() {
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })
  }

  it("closes on Escape", () => {
    let closed = 0
    act(() =>
      root.render(
        <StrictMode>
          <Modal open onClose={() => (closed += 1)} title="Export" closeLabel="Close">
            content
          </Modal>
        </StrictMode>,
      ),
    )

    escape()
    expect(closed).toBe(1)
  })

  // A menu opened from inside portals to the body, so a dialog that answers the press first
  // closes out from under the menu and swallows the press that was meant for it.
  it("leaves the press to a menu opened from inside it", () => {
    let closed = 0
    act(() =>
      root.render(
        <StrictMode>
          <Modal open onClose={() => (closed += 1)} title="Export" closeLabel="Close">
            content
          </Modal>
        </StrictMode>,
      ),
    )

    const menu = document.createElement("div")
    menu.setAttribute("role", "menu")
    document.body.appendChild(menu)
    escape()
    expect(closed).toBe(0)

    menu.remove()
    escape()
    expect(closed).toBe(1)
  })

  it("lets a queued confirmation consume Escape without closing the modal underneath", async () => {
    let closed = 0
    let answer: boolean | undefined
    act(() =>
      root.render(
        <StrictMode>
          <Modal open onClose={() => (closed += 1)} title="Restore" closeLabel="Close">
            content
          </Modal>
          <DialogHost />
        </StrictMode>,
      ),
    )

    act(() => {
      void useDialogStore.getState().confirm({ title: "Replace everything?" }).then((value) => {
        answer = value
      })
    })
    escape()
    await act(async () => Promise.resolve())

    expect(answer).toBe(false)
    expect(closed).toBe(0)
    expect(document.querySelector('[aria-label="Restore"]')).not.toBeNull()
  })

  it("closes only the dialog opened last when two modals are open", () => {
    let closedFirst = 0
    let closedSecond = 0
    act(() =>
      root.render(
        <StrictMode>
          <Modal open onClose={() => (closedFirst += 1)} title="First" closeLabel="Close">
            first
          </Modal>
          <Modal open onClose={() => (closedSecond += 1)} title="Second" closeLabel="Close">
            second
          </Modal>
        </StrictMode>,
      ),
    )

    escape()

    expect(closedSecond).toBe(1)
    expect(closedFirst).toBe(0)
  })
})

describe("Modal dismissal options", () => {
  function wash(): HTMLElement {
    return document.querySelector('[role="dialog"]')!.previousElementSibling as HTMLElement
  }

  it("closes on a wash click by default", () => {
    let closed = 0
    act(() =>
      root.render(
        <StrictMode>
          <Modal open onClose={() => (closed += 1)} title="Export" closeLabel="Close">
            content
          </Modal>
        </StrictMode>,
      ),
    )

    act(() => wash().click())
    expect(closed).toBe(1)
  })

  it("leaves the wash inert when backdrop dismissal is off", () => {
    let closed = 0
    act(() =>
      root.render(
        <StrictMode>
          <Modal open onClose={() => (closed += 1)} title="Export" closeLabel="Close" dismissOnBackdrop={false}>
            content
          </Modal>
        </StrictMode>,
      ),
    )

    act(() => wash().click())
    expect(closed).toBe(0)
  })

  it("leaves the close button out of the header when told to", () => {
    act(() =>
      root.render(
        <StrictMode>
          <Modal open onClose={() => {}} title="Export" closeButton={false}>
            content
          </Modal>
        </StrictMode>,
      ),
    )

    expect(document.querySelector('[role="dialog"] header button')).toBeNull()
  })

  it("puts the eyebrow in the header, above the title", () => {
    act(() =>
      root.render(
        <StrictMode>
          <Modal open onClose={() => {}} title="Export" closeLabel="Close" eyebrow={<span data-eyebrow>Beta</span>}>
            content
          </Modal>
        </StrictMode>,
      ),
    )

    const eyebrow = document.querySelector("[data-eyebrow]")!
    const title = document.querySelector('[role="dialog"] h2')!
    expect(document.querySelector('[role="dialog"] header')!.contains(eyebrow)).toBe(true)
    expect(eyebrow.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe("Modal suspended", () => {
  function escape() {
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })
  }

  it("hides, ignores Escape and takes no clicks while another surface owns the window, then comes back", () => {
    let closed = 0
    function Host({ suspended }: { suspended: boolean }) {
      return (
        <Modal open onClose={() => (closed += 1)} title="Export" closeLabel="Close" suspended={suspended}>
          content
        </Modal>
      )
    }

    act(() => root.render(<StrictMode><Host suspended /></StrictMode>))
    const wrapper = document.querySelector('[role="dialog"]')!.parentElement as HTMLElement
    expect(wrapper.getAttribute("aria-hidden")).toBe("true")
    expect(wrapper.style.opacity).toBe("0")
    expect(wrapper.style.pointerEvents).toBe("none")
    escape()
    expect(closed).toBe(0)

    act(() => root.render(<StrictMode><Host suspended={false} /></StrictMode>))
    expect(wrapper.getAttribute("aria-hidden")).toBeNull()
    expect(wrapper.style.opacity).toBe("")
    expect(wrapper.style.pointerEvents).toBe("")
    escape()
    expect(closed).toBe(1)
  })

  it("puts focus back on the control that had it once the other surface has let go", async () => {
    function Host({ suspended }: { suspended: boolean }) {
      return (
        <Modal open onClose={() => {}} title="Export" closeLabel="Close" suspended={suspended}>
          <button type="button">Inside</button>
        </Modal>
      )
    }

    act(() => root.render(<StrictMode><Host suspended={false} /></StrictMode>))
    const inside = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
      (button) => button.textContent === "Inside",
    )!
    act(() => inside.focus())

    act(() => root.render(<StrictMode><Host suspended /></StrictMode>))
    act(() => inside.blur())
    expect(document.activeElement).toBe(document.body)

    act(() => root.render(<StrictMode><Host suspended={false} /></StrictMode>))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(document.activeElement).toBe(inside)
  })
})
