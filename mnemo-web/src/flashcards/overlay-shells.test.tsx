// @vitest-environment jsdom

/**
 * The four lazy overlays draw a placeholder shell while their chunk loads, and the shell has to
 * open at the geometry the dialog will have: a bounded frame, a body with a definite height
 * wherever a skeleton fills it, and a footer so the frame is complete.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CardTypeOverlay } from "./cardtypes/CardTypeOverlay"
import { useCardTypeManager } from "./cardtypes/store"
import { useCardEditor } from "./editor/store"
import { FactEditorOverlay } from "./facts/FactEditorOverlay"
import { ReviewSettingsOverlay } from "./presets/ReviewSettingsOverlay"
import { useReviewSettings } from "./presets/store"
import { useTransfer } from "./transfer/store"
import { TransferOverlay } from "./transfer/TransferOverlay"

// The chunks never resolve here: the shell is what is under test, and it is on screen the
// instant the store opens, before any import settles.
vi.mock("./cardtypes/CardTypeManager", () => ({ CardTypeManager: () => null }))
vi.mock("./facts/FactEditor", () => ({ FactEditor: () => null }))
vi.mock("./presets/ReviewSettings", () => ({ ReviewSettings: () => null }))
vi.mock("./transfer/TransferDialog", () => ({ TransferDialog: () => null }))

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
  useCardTypeManager.setState({ open: false, initialTypeId: null })
  useCardEditor.setState({ target: null })
  useReviewSettings.setState({ target: null })
  useTransfer.setState({ target: null })
})

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean)
}

/** The frame: the one element sized against the viewport. */
function shell(): HTMLElement {
  const frame = [...document.body.querySelectorAll<HTMLElement>("div")].find((el) =>
    classesOf(el).some((c) => c.includes("86vh")),
  )
  expect(frame, "the loading shell is not on screen").toBeDefined()
  return frame!
}

function hasDefiniteHeight(el: Element): boolean {
  return classesOf(el).some((c) => /^(h|size)-\[\d+px\]$/.test(c) || /^(h|size)-\d+(\.\d+)?$/.test(c))
}

function expectShellShape(): void {
  const frame = shell()
  const classes = classesOf(frame)
  expect(classes).toContain("max-h-[86vh]")
  expect(classes).not.toContain("h-[86vh]")

  // Header, body, footer: the frame is the whole dialog's outline, not the top of one.
  expect(frame.children.length).toBeGreaterThanOrEqual(3)

  const skeletons = [...frame.querySelectorAll<HTMLElement>('[data-slot="skeleton"]')]
  expect(skeletons.length).toBeGreaterThan(0)
  for (const skeleton of skeletons) {
    const fillsParent = classesOf(skeleton).includes("h-full")
    if (fillsParent) {
      expect(hasDefiniteHeight(skeleton.parentElement!), "an h-full skeleton needs a parent of definite height").toBe(true)
    } else {
      expect(hasDefiniteHeight(skeleton), "a skeleton needs a height of its own").toBe(true)
    }
  }
}

describe("the lazy overlay shells", () => {
  it("card types: a bounded frame with a definite body", () => {
    act(() => useCardTypeManager.getState().show())
    act(() => root.render(<CardTypeOverlay />))
    expectShellShape()
  })

  it("review settings: a bounded frame with a definite body", () => {
    act(() => useReviewSettings.getState().open("deck-1", "Geo"))
    act(() => root.render(<ReviewSettingsOverlay />))
    expectShellShape()
  })

  it("fact editor: a bounded frame with a definite body", () => {
    act(() => useCardEditor.getState().openAdd("deck-1"))
    act(() => root.render(<FactEditorOverlay />))
    expectShellShape()
  })

  it("transfer: a bounded frame with a definite body", () => {
    act(() => useTransfer.getState().open({ direction: "both", scope: null }))
    act(() => root.render(<TransferOverlay />))
    expectShellShape()
  })
})
