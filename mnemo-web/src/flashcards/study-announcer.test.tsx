// @vitest-environment jsdom

/**
 * The review, cram and test screens rely on this for their only screen reader signal when
 * the answer reveals or the card changes. A screen reader treats an unchanged live region
 * as nothing happening, so the repeat case (the same wording twice in a row, e.g. two cards
 * with an identical progress count) is the one that actually needs proving, not just the
 * happy path of a message changing.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { StudyAnnouncer, useStudyAnnouncer } from "./study-announcer"

let announcer: ReturnType<typeof useStudyAnnouncer> | null = null
let container: HTMLDivElement
let root: Root

function Harness() {
  announcer = useStudyAnnouncer()
  return <StudyAnnouncer message={announcer.message} />
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<Harness />))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function liveRegion(): HTMLElement {
  const el = container.querySelector('[role="status"]')
  expect(el, "the live region is not on screen").not.toBeNull()
  return el as HTMLElement
}

describe("useStudyAnnouncer", () => {
  it("starts silent", () => {
    expect(liveRegion().textContent).toBe("")
  })

  it("speaks the message it is given", () => {
    act(() => announcer!.announce("Answer revealed"))

    expect(liveRegion().textContent).toBe("Answer revealed")
  })

  it("changes the text on a genuinely new message", () => {
    act(() => announcer!.announce("Card 1 of 5"))
    act(() => announcer!.announce("Card 2 of 5"))

    expect(liveRegion().textContent).toBe("Card 2 of 5")
  })

  it("still changes the live region text when the same message repeats", () => {
    // Two cards in a row can land on the same progress count (a page that starts a new
    // batch at "Card 1 of 5" twice), and a screen reader only speaks a live region whose
    // text actually changed, so re-announcing the identical string has to produce a
    // different string or the second card goes unannounced.
    act(() => announcer!.announce("Card 1 of 5"))
    const first = liveRegion().textContent

    act(() => announcer!.announce("Card 1 of 5"))
    const second = liveRegion().textContent

    expect(second).not.toBe(first)
    expect(second?.trim()).toBe("Card 1 of 5")
  })
})

describe("StudyAnnouncer", () => {
  it("renders as a polite, visually hidden status region", () => {
    const el = liveRegion()

    expect(el.getAttribute("aria-live")).toBe("polite")
    expect(el.className).toContain("sr-only")
  })
})
