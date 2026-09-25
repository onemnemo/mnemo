// @vitest-environment jsdom

import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { CapMarkers } from "./CapMarkers"
import { capMarker, capMarkerId } from "./line-marks"

function mount(ui: ReactNode): HTMLElement {
  const root = document.createElement("div")
  root.innerHTML = renderToStaticMarkup(<svg>{ui}</svg>)
  return root
}

describe("CapMarkers", () => {
  it("paints each end in the line's own colour rather than asking the engine for it", () => {
    const root = mount(<CapMarkers owner="edge-a" color="var(--accent)" start="dot" end="arrow" />)

    const start = root.querySelector(`#${capMarkerId("edge-a", "start")}`)
    const end = root.querySelector(`#${capMarkerId("edge-a", "end")}`)
    expect(start?.querySelector("circle")?.getAttribute("style")).toContain("var(--accent)")
    expect(end?.querySelector("path")?.getAttribute("style")).toContain("var(--accent)")
    expect(root.innerHTML).not.toContain("context-stroke")
  })

  it("renders nothing for a line with plain ends", () => {
    const root = mount(<CapMarkers owner="edge-a" color="red" start="none" end={undefined} />)
    expect(root.querySelector("marker")).toBeNull()
  })

  it("points each end at its own marker, and at none for a plain end", () => {
    expect(capMarker("dot", "edge-a", "start")).toBe(`url(#${capMarkerId("edge-a", "start")})`)
    expect(capMarker("none", "edge-a", "end")).toBeUndefined()
  })

  it("keeps an owner id usable inside url()", () => {
    expect(capMarkerId("line-a b:c", "end")).toBe("mm-cap-end-line-a_b_c")
  })
})
