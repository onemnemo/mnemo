import { describe, expect, it } from "vitest"

import { matchStyleOps } from "./match-style"

describe("matchStyleOps", () => {
  it("gives every other element the primary's look, clearing what the primary leaves unset", () => {
    const ops = matchStyleOps({ stroke: "palette.3", nodeShape: "pill" }, [
      { id: "a", style: { fill: "palette.1", fontScale: "l" } },
      { id: "b" },
    ])
    expect(ops).toEqual([
      { op: "set", id: "a", clear_style: true, style: { stroke: "palette.3", nodeShape: "pill" } },
      { op: "set", id: "b", clear_style: true, style: { stroke: "palette.3", nodeShape: "pill" } },
    ])
  })

  it("keeps each element's own icon", () => {
    const [set] = matchStyleOps({ icon: "🌱", fill: "palette.2" }, [{ id: "a", style: { icon: "📘" } }])
    expect(set.style).toEqual({ icon: "📘", fill: "palette.2" })
  })

  it("resets the others to their template when the primary has no style", () => {
    const [set] = matchStyleOps(null, [{ id: "a", style: { stroke: "palette.4" } }])
    expect(set).toEqual({ op: "set", id: "a", clear_style: true, style: {} })
  })
})
