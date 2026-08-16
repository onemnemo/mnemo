// @vitest-environment jsdom

/**
 * The contract AppIcon exists to keep: a caller names an icon and gets a correctly sized,
 * currentColor-tinted glyph, without knowing or caring whether it came from lucide or
 * from the project's own SVG tree.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { AppIcon } from "./AppIcon"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(node: React.ReactNode) {
  act(() => root.render(node))
  return container
}

describe("AppIcon", () => {
  it("renders a lucide glyph at the requested size", () => {
    const svg = render(<AppIcon name="house" size={20} />).querySelector("svg")
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute("width")).toBe("20")
    expect(svg?.getAttribute("height")).toBe("20")
  })

  it("renders a project icon at the requested size", () => {
    const host = render(<AppIcon name="common/search" size={20} />).firstElementChild as HTMLElement
    expect(host.querySelector("svg")).not.toBeNull()
    expect(host.style.width).toBe("20px")
    expect(host.style.height).toBe("20px")
  })

  it("defaults lucide glyphs to the thinner stroke, and lets a caller override it", () => {
    expect(render(<AppIcon name="house" />).querySelector("svg")?.getAttribute("stroke-width")).toBe("1.5")
    expect(render(<AppIcon name="house" strokeWidth={2} />).querySelector("svg")?.getAttribute("stroke-width")).toBe("2")
  })

  it("is decorative unless given a title", () => {
    expect(render(<AppIcon name="house" />).querySelector("svg")?.getAttribute("aria-hidden")).toBe("true")

    const labelled = render(<AppIcon name="house" title="Overview" />).querySelector("svg")
    expect(labelled?.getAttribute("aria-label")).toBe("Overview")
    expect(labelled?.getAttribute("role")).toBe("img")
  })

  it("renders nothing for an unknown name rather than breaking the row around it", () => {
    expect(render(<AppIcon name="definitely-not-an-icon" />).childElementCount).toBe(0)
  })
})
