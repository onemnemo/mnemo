import { describe, expect, it } from "vitest"

import type { AbsoluteLine } from "../scene/line-geometry"

import { defaultLine, drawFrom, drawTo, dropBend, dropEnd, readoutText } from "./line-gesture"

const LINE: AbsoluteLine = { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, bend: null, startAt: null, endAt: null }
const NODE = { id: "n", box: { x: 200, y: -25, width: 80, height: 50 } }
const SELF = { id: "l", box: { x: 0, y: -8, width: 116, height: 16 } }

describe("dragging an end", () => {
  it("follows the pointer when nothing is in reach", () => {
    const drop = dropEnd(LINE, "end", { x: 150, y: 40 }, [NODE, SELF], "l", 1)

    expect(drop.line.end).toEqual({ x: 150, y: 40 })
    expect(drop.line.endAt).toBeNull()
    expect(drop.hit).toBeNull()
    expect(drop.target).toBeNull()
  })

  it("shows an element's anchors as the pointer comes into reach, before it locks", () => {
    const drop = dropEnd(LINE, "end", { x: 170, y: 0 }, [NODE], "l", 1)

    expect(drop.target?.id).toBe("n")
    expect(drop.hit).toBeNull()
    expect(drop.line.end).toEqual({ x: 170, y: 0 })
  })

  it("locks onto the nearest anchor and stores the attachment", () => {
    const drop = dropEnd(LINE, "end", { x: 195, y: 3 }, [NODE], "l", 1)

    expect(drop.hit).toMatchObject({ elementId: "n", side: "left" })
    expect(drop.line.end).toEqual({ x: 200, y: 0 })
    expect(drop.line.endAt).toEqual({ elementId: "n", side: "left" })
  })

  it("never locks onto the line itself", () => {
    const drop = dropEnd(LINE, "start", { x: 0, y: -8 }, [SELF], "l", 1)

    expect(drop.hit).toBeNull()
  })

  it("reads its reach in screen pixels, which is more canvas when zoomed out and less when in", () => {
    expect(dropEnd(LINE, "end", { x: 180, y: 0 }, [NODE], "l", 1).hit).toBeNull()
    expect(dropEnd(LINE, "end", { x: 180, y: 0 }, [NODE], "l", 0.5).hit).not.toBeNull()
    expect(dropEnd(LINE, "end", { x: 190, y: 0 }, [NODE], "l", 2).hit).toBeNull()
  })

  it("moves the other end's attachment along untouched", () => {
    const attached = { ...LINE, startAt: { elementId: "a", side: "right" as const } }
    const drop = dropEnd(attached, "end", { x: 50, y: 50 }, [], "l", 1)

    expect(drop.line.startAt).toEqual({ elementId: "a", side: "right" })
  })
})

describe("dragging the bend", () => {
  it("curves the line through the pointer", () => {
    expect(dropBend(LINE, { x: 50, y: 40 }, 1).bend).toEqual({ x: 50, y: 40 })
  })

  it("straightens the line when the bend is let go on the chord", () => {
    expect(dropBend({ ...LINE, bend: { x: 50, y: 40 } }, { x: 50, y: 4 }, 1).bend).toBeNull()
    expect(dropBend({ ...LINE, bend: { x: 50, y: 40 } }, { x: 50, y: 10 }, 1).bend).toEqual({ x: 50, y: 10 })
  })
})

describe("drawing a line", () => {
  it("runs from the press to the pointer", () => {
    const drop = drawTo({ x: 0, y: 0 }, null, { x: 30, y: -40 }, false, [], 1)

    expect(drop.line).toEqual({ start: { x: 0, y: 0 }, end: { x: 30, y: -40 }, bend: null, startAt: null, endAt: null })
  })

  it("holds the angle to a fifteen degree step under Shift, keeping the length", () => {
    const drop = drawTo({ x: 0, y: 0 }, null, { x: 100, y: -8 }, true, [], 1)

    expect(drop.line.end.y).toBeCloseTo(0)
    expect(drop.line.end.x).toBeCloseTo(Math.hypot(100, 8))
  })

  it("meets an anchor in reach whether or not Shift is held", () => {
    const drop = drawTo({ x: 0, y: 0 }, null, { x: 197, y: 4 }, true, [NODE], 1)

    expect(drop.line.end).toEqual({ x: 200, y: 0 })
    expect(drop.line.endAt).toEqual({ elementId: "n", side: "left" })
  })

  it("starts on an anchor when the press was within reach of one", () => {
    expect(drawFrom({ x: 282, y: 2 }, [NODE], 1)).toEqual({
      start: { x: 280, y: 0 },
      startAt: { elementId: "n", side: "right" },
    })
    expect(drawFrom({ x: 10, y: 10 }, [NODE], 1)).toEqual({ start: { x: 10, y: 10 }, startAt: null })
  })

  it("plants a flat line of a fixed length on a plain click", () => {
    expect(defaultLine({ x: 5, y: 7 }).end).toEqual({ x: 165, y: 7 })
  })

  it("says the angle and the length beside the cursor", () => {
    expect(readoutText({ x: 0, y: 0 }, { x: 100, y: -100 })).toBe("45° · 141")
    expect(readoutText({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe("0° · 10")
  })
})
