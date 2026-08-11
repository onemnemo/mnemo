import { describe, expect, it } from "vitest"

import type { MindmapDocument } from "../model/document"
import type { SceneElement } from "../model/scene"
import { branchRootOf, branchSwatchOf } from "./branch"
import { analyzeHierarchy } from "./hierarchy"

/** Root, two branches off it, and a grandchild two levels down one of them. */
const document: MindmapDocument = {
  id: "m",
  elements: [
    { id: "root", content: { $type: "text", text: "Root" } },
    { id: "a", content: { $type: "text", text: "A" } },
    { id: "b", content: { $type: "text", text: "B" } },
    { id: "a1", content: { $type: "text", text: "A1" } },
    { id: "a1x", content: { $type: "text", text: "A1x" } },
    { id: "free", kind: "shape", content: { $type: "shape", shape: "rectangle" } },
  ],
  edges: [
    { id: "e1", fromId: "root", toId: "a" },
    { id: "e2", fromId: "root", toId: "b" },
    { id: "e3", fromId: "a", toId: "a1" },
    { id: "e4", fromId: "a1", toId: "a1x" },
  ],
}

const hierarchy = analyzeHierarchy(document)

/** Only the two fields the swatch reader looks at; the rest is not this function's business. */
function coloured(colours: { branchColor?: string; stroke?: string }): SceneElement {
  return colours as unknown as SceneElement
}

describe("branchRootOf", () => {
  it("returns a depth-1 node itself", () => {
    expect(branchRootOf(hierarchy, "a")).toBe("a")
  })

  it("walks up to the depth-1 ancestor from anywhere below it", () => {
    expect(branchRootOf(hierarchy, "a1")).toBe("a")
    expect(branchRootOf(hierarchy, "a1x")).toBe("a")
  })

  it("keeps the two branches apart", () => {
    expect(branchRootOf(hierarchy, "b")).toBe("b")
  })

  it("has no branch for a root", () => {
    // A root sits above every branch, so recolouring "its" branch would mean recolouring all of them.
    expect(branchRootOf(hierarchy, "root")).toBeNull()
  })

  it("has no branch for something that is not in the tree", () => {
    expect(branchRootOf(hierarchy, "free")).toBeNull()
    expect(branchRootOf(hierarchy, "nobody")).toBeNull()
  })
})

describe("branchSwatchOf", () => {
  it("reads the slot off the branch colour the node is drawn in", () => {
    expect(branchSwatchOf(coloured({ branchColor: "var(--branch-3)" }))).toBe(3)
  })

  it("falls back to the stroke when branch colouring is off", () => {
    expect(branchSwatchOf(coloured({ stroke: "var(--branch-7)" }))).toBe(7)
  })

  it("prefers the branch colour, which is what is actually on screen", () => {
    expect(branchSwatchOf(coloured({ branchColor: "var(--branch-2)", stroke: "var(--branch-5)" }))).toBe(2)
  })

  it("says nothing for a colour that is not one of the eight", () => {
    // A hand-written hex and a template with no branch ramp both land here. Guessing a slot would
    // light a swatch for a hue nothing on the map has.
    expect(branchSwatchOf(coloured({ stroke: "#3366ff" }))).toBeNull()
    expect(branchSwatchOf(coloured({}))).toBeNull()
  })
})
