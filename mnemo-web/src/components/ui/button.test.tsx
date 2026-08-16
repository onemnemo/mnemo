// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { Button } from "./button"

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

describe("Button", () => {
  it("renders the icon slots around its children", () => {
    act(() => {
      root.render(
        <Button icon={<span>i</span>} trailing={<span>t</span>}>
          Study
        </Button>,
      )
    })

    expect(container.querySelector("button")?.textContent).toBe("iStudyt")
  })

  it("renders as its child element, keeping the button's own classes", () => {
    // The icon slots are deliberately dropped here: Slot needs exactly one element child, and
    // handing it [undefined, child, undefined] throws even when both are absent.
    act(() => {
      root.render(
        <Button asChild icon={<span>i</span>}>
          <a href="#/flashcards">Study</a>
        </Button>,
      )
    })

    const link = container.querySelector("a")
    expect(link?.textContent).toBe("Study")
    expect(container.querySelector("button")).toBeNull()
    expect(link?.className).toContain("rounded-lg")
  })
})
