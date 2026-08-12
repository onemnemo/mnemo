import { describe, expect, it } from "vitest"

import type { SceneElement } from "../model/scene"
import { accentOf, branchSwatchOf, markColor } from "./branch"
import { cssColor } from "./tokens"

/** Only the fields the colour readers look at; the rest is not their business. */
function coloured(colours: { branchColor?: string; stroke?: string; fill?: string }): SceneElement {
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

describe("markColor", () => {
  it("keeps a fill somebody chose", () => {
    expect(markColor(coloured({ fill: "var(--accent)", stroke: cssColor("stroke") }))).toBe("var(--accent)")
  })

  it("reaches past a paper fill to the branch hue, which is where a branch's colour lives", () => {
    expect(markColor(coloured({ fill: cssColor("surface"), stroke: "var(--branch-3)" }))).toBe("var(--branch-3)")
  })

  it("marks an element nobody has coloured in the muted ink", () => {
    // The whole of the defect. Paper is the honest answer at full size and no answer at all on a
    // panel that is itself paper: an ordinary map showed its coloured roots and nothing else.
    expect(markColor(coloured({ fill: cssColor("surface"), stroke: cssColor("stroke") }))).toBe("var(--ink-3)")
    expect(markColor(coloured({ fill: cssColor("surfaceAlt") }))).toBe("var(--ink-3)")
    expect(markColor(coloured({}))).toBe("var(--ink-3)")
  })

  it("keeps a hand-written colour, which is not one of the eight and was still chosen", () => {
    expect(markColor(coloured({ fill: "#3366ff" }))).toBe("#3366ff")
  })
})
