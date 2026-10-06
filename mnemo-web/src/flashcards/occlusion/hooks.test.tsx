// @vitest-environment jsdom

import { act, useRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { chromeOf, useChrome } from "./hooks"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let seen = -1

beforeEach(() => {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  // jsdom has no layout: heights come from data-h so the formula can be pinned.
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return Number(this.dataset.h ?? 0)
    },
  })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight")
})

function Probe({ card, row }: { card: number; row: number }) {
  const cardRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  seen = useChrome(cardRef, rowRef)
  return (
    <div ref={cardRef} data-h={card}>
      <div ref={rowRef} data-h={row} />
    </div>
  )
}

describe("chrome", () => {
  it("is the card minus the image row", () => {
    expect(chromeOf(610, 403)).toBe(207)
    expect(chromeOf(100, 403)).toBe(0)
  })

  it("does not change when the answer makes the row taller than the image", () => {
    // Side by side the card is padding + question + row; a tall answer grows the row and the card
    // together, so what is left over for the image box must not move.
    act(() => root.render(<Probe key="a" card={410} row={304} />))
    const before = seen
    act(() => root.render(<Probe key="b" card={560} row={454} />))

    expect(before).toBe(106)
    expect(seen).toBe(before)
  })
})
