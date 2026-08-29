// @vitest-environment jsdom

/**
 * Checks onboarding layering and pointer handling while the exit confirmation is open.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DialogHost } from "@/components/shell/DialogHost"
import { Z_LAYERS } from "@/lib/z-layers"
import { useSettingsStore } from "@/settings/store"
import { useDialogStore } from "@/stores/dialog"

import { OnboardingWizard } from "./OnboardingWizard"

vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string) => key,
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  // A fresh install: the snapshot loaded, and nothing says onboarding is done.
  useSettingsStore.setState({ values: {}, secrets: {}, loaded: true, failed: false })
  useDialogStore.setState({ queue: [] })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function screen(): HTMLElement {
  const el = container.querySelector<HTMLElement>(".fixed.inset-0")
  expect(el, "the onboarding screen is not on the page").not.toBeNull()
  return el!
}

function pushExitConfirm(): void {
  useDialogStore.setState({
    queue: [
      {
        kind: "confirm",
        id: "exit-1",
        title: "Quit Mnemo?",
        confirmLabel: "Quit",
        cancelLabel: "Cancel",
        destructive: false,
        resolve: () => {},
      },
    ],
  })
}

describe("OnboardingWizard stacking", () => {
  it("sits at the layer the shared order gives it", () => {
    act(() => root.render(<OnboardingWizard />))

    expect(screen().style.zIndex).toBe(String(Z_LAYERS.onboarding))
  })
})

describe("OnboardingWizard yielding to a pending dialog", () => {
  it("is visible and interactive with no dialog pending", () => {
    act(() => root.render(<OnboardingWizard />))

    const el = screen()
    expect(el.style.opacity).toBe("1")
    expect(el.style.pointerEvents).not.toBe("none")
    expect(el.getAttribute("aria-hidden")).toBe("false")
  })

  it("dims and stops accepting clicks while the dialog queue is non-empty", () => {
    act(() => root.render(<OnboardingWizard />))

    act(() => pushExitConfirm())

    const el = screen()
    expect(el.style.opacity).toBe("0")
    expect(el.style.pointerEvents).toBe("none")
    expect(el.getAttribute("aria-hidden")).toBe("true")
  })

  it("comes back once the dialog is settled", () => {
    act(() => root.render(<OnboardingWizard />))
    act(() => pushExitConfirm())
    expect(screen().style.opacity).toBe("0")

    act(() => useDialogStore.setState({ queue: [] }))

    const el = screen()
    expect(el.style.opacity).toBe("1")
    expect(el.style.pointerEvents).not.toBe("none")
  })
})

describe("the exit confirm raised over a yielded first-run screen", () => {
  it("answers the first click, with the rest of the page inert around it", async () => {
    act(() =>
      root.render(
        <>
          <OnboardingWizard />
          <DialogHost />
        </>,
      ),
    )

    const answers: boolean[] = []
    await act(async () => {
      void useDialogStore
        .getState()
        .confirm({ title: "Quit Mnemo?", confirmLabel: "Quit", cancelLabel: "Cancel" })
        .then((value) => answers.push(value))
    })

    // The body is what the dialog library disables, and the first-run screen behind is
    // meant to be caught by it.
    expect(document.body.style.pointerEvents).toBe("none")
    expect(screen().style.pointerEvents).toBe("none")

    const content = document.querySelector<HTMLElement>('[role="dialog"]')
    expect(content, "the confirm dialog did not mount").not.toBeNull()
    // The portal must not override the dialog content pointer-events opt-in.
    expect(content!.style.pointerEvents).toBe("auto")
    for (let node = content!.parentElement; node && node !== document.body; node = node.parentElement) {
      expect(node.style.pointerEvents).not.toBe("none")
    }

    const quit = [...content!.querySelectorAll("button")].find((button) => button.textContent === "Quit")
    expect(quit, "the confirm button is not on screen").not.toBeUndefined()

    await act(async () => {
      quit!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(answers).toEqual([true])
    expect(useDialogStore.getState().queue).toHaveLength(0)
    expect(document.body.style.pointerEvents).not.toBe("none")
    expect(screen().style.pointerEvents).not.toBe("none")
  })
})
