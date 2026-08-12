/**
 * What a selection turns into when it is lined up: which elements the maths sees, and what a frame
 * drags along behind it.
 */

import { describe, expect, it } from "vitest"

import { alignTargets, canDistribute, planAlign, type AlignCandidate } from "./align-plan"
import type { Point } from "../model/scene"

const box = (id: string, x: number, y: number, width = 20, height = 10): AlignCandidate => ({
  id,
  x,
  y,
  width,
  height,
})

const frame = (id: string, x: number, y: number, members: string[]): AlignCandidate => ({
  ...box(id, x, y, 60, 40),
  members,
})

const world = (positions: Record<string, Point>) => (id: string) => positions[id]

describe("what an align acts on", () => {
  it("leaves out a selected frame's members, which the frame is already moving", () => {
    const selected = [frame("f", 0, 0, ["a"]), box("a", 10, 10), box("b", 100, 0)]

    expect(alignTargets(selected).map((target) => target.id)).toEqual(["f", "b"])
  })

  it("takes everything when no frame is selected", () => {
    const selected = [box("a", 0, 0), box("b", 100, 0)]

    expect(alignTargets(selected)).toEqual(selected)
  })

  it("counts what is left when deciding whether there is anything to spread out", () => {
    // Three selected, but the frame is holding two of them, so only two boxes really move.
    expect(canDistribute([frame("f", 0, 0, ["a", "b"]), box("a", 5, 5), box("b", 20, 5)])).toBe(false)
    expect(canDistribute([box("a", 0, 0), box("b", 50, 0), box("c", 100, 0)])).toBe(true)
  })
})

describe("a frame being lined up", () => {
  it("takes its contents with it, since its own box is only ever where they are", () => {
    const moves = planAlign(
      "left",
      [frame("f", 100, 0, ["a", "b"]), box("z", 20, 0)],
      world({ a: { x: 110, y: 10 }, b: { x: 140, y: 25 } }),
    )

    // The frame goes from 100 to 20, so everything it holds goes 80 to the left with it.
    expect(moves).toEqual([
      { id: "f", x: 20, y: 0 },
      { id: "a", x: 30, y: 10 },
      { id: "b", x: 60, y: 25 },
    ])
  })

  it("moves a member exactly once when two frames both claim it", () => {
    const moves = planAlign(
      "top",
      [frame("f", 0, 40, ["shared"]), frame("g", 200, 0, ["shared"])],
      world({ shared: { x: 10, y: 50 } }),
    )

    expect(moves.filter((move) => move.id === "shared")).toHaveLength(1)
  })

  it("moves the rest of a frame whose membership names something that is gone", () => {
    const moves = planAlign("left", [frame("f", 100, 0, ["gone", "a"]), box("z", 20, 0)], world({ a: { x: 110, y: 0 } }))

    expect(moves.map((move) => move.id)).toEqual(["f", "a"])
  })

  it("leaves a frame that was already in place holding its contents still", () => {
    const moves = planAlign("left", [frame("f", 20, 0, ["a"]), box("z", 20, 0)], world({ a: { x: 30, y: 0 } }))

    expect(moves).toEqual([])
  })
})
