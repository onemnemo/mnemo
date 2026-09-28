import { describe, expect, it } from "vitest"

import { plantOp } from "./plant"

describe("plantOp", () => {
  it("plants a node with the picked style", () => {
    const planted = plantOp("node", [10, 20], { shape: "rectangle", nodeStyle: "pill" })

    expect(planted).toMatchObject({ op: "add", nodes: [{ ref: "n", xy: [10, 20], style: { nodeShape: "pill" } }] })
  })

  it("leaves the style to the template when nothing is picked", () => {
    const planted = plantOp("node", [10, 20], { shape: "rectangle", nodeStyle: null })

    expect(JSON.stringify(planted)).not.toContain("style")
  })

  it("plants the armed shape, which a node style says nothing about", () => {
    const planted = plantOp("shape", [0, 0], { shape: "hexagon", nodeStyle: "pill" })

    expect(planted).toMatchObject({ op: "add_el", kind: "shape", content: { shape: "hexagon" } })
    expect(JSON.stringify(planted)).not.toContain("nodeShape")
  })
})
