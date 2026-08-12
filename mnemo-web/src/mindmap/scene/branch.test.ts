import { describe, expect, it } from "vitest"

import type { SceneElement } from "../model/scene"
import { accentOf, branchSwatchOf } from "./branch"

/** Only the two fields the colour readers look at; the rest is not their business. */
function coloured(colours: { branchColor?: string; stroke?: string }): SceneElement {
  return colours as unknown as SceneElement
}

describe("accentOf", () => {
  it("takes the element's own colour over the one its position gave it", () => {
    // The reported defect, in one line. The cascade resolves a node's own stroke into `stroke` and
    // still reports the branch hue beside it; reading the branch first made an override invisible,
    // which is why colouring one node used to be written down its whole branch.
    expect(accentOf(coloured({ branchColor: "var(--branch-2)", stroke: "var(--branch-5)" }))).toBe(
      "var(--branch-5)",
    )
  })

  it("falls back to the branch hue for an element that names no colour", () => {
    expect(accentOf(coloured({ branchColor: "var(--branch-2)" }))).toBe("var(--branch-2)")
  })

  it("has no colour for an element with neither", () => {
    expect(accentOf(coloured({}))).toBeUndefined()
  })
})

describe("branchSwatchOf", () => {
  it("reads the slot off the colour the node is drawn in", () => {
    expect(branchSwatchOf(coloured({ branchColor: "var(--branch-3)" }))).toBe(3)
    expect(branchSwatchOf(coloured({ stroke: "var(--branch-7)" }))).toBe(7)
  })

  it("lights the node's own hue rather than its branch's", () => {
    expect(branchSwatchOf(coloured({ branchColor: "var(--branch-2)", stroke: "var(--branch-5)" }))).toBe(5)
  })

  it("says nothing for a colour that is not one of the eight", () => {
    // A hand-written hex and a template with no palette ramp both land here. Guessing a slot would
    // light a swatch for a hue nothing on the map has.
    expect(branchSwatchOf(coloured({ stroke: "#3366ff" }))).toBeNull()
    expect(branchSwatchOf(coloured({}))).toBeNull()
  })
})
