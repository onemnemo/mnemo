import { describe, expect, it } from "vitest"

import { elementsInLoop, loopTouches, pointInLoop } from "./lasso"

const square = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
]

/** A U shape: two arms joined along the bottom, open at the top. */
const cup = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 80 },
  { x: 80, y: 80 },
  { x: 80, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
]

const box = (x: number, y: number, width = 10, height = 10) => ({ x, y, width, height })

describe("the lasso", () => {
  it("knows inside from outside", () => {
    expect(pointInLoop({ x: 50, y: 50 }, square)).toBe(true)
    expect(pointInLoop({ x: 150, y: 50 }, square)).toBe(false)
  })

  it("keeps inside a point the loop goes round twice", () => {
    expect(pointInLoop({ x: 50, y: 50 }, [...square, ...square])).toBe(true)
  })

  it("catches a box that only touches the loop along an edge", () => {
    expect(loopTouches(square, box(100, 40))).toBe(true)
  })

  it("catches a box wholly inside the loop", () => {
    expect(loopTouches(square, box(40, 40))).toBe(true)
  })

  it("catches a box the loop only crosses", () => {
    expect(loopTouches(square, box(95, 40, 20, 10))).toBe(true)
  })

  it("catches a box the loop dips into without a corner inside it", () => {
    expect(loopTouches(square, box(-20, 40, 200, 5))).toBe(true)
  })

  it("misses a box in the hollow of a loop that curls around it", () => {
    expect(loopTouches(cup, box(40, 20, 20, 20))).toBe(false)
  })

  it("misses what it never reaches, and a loop too short to have an inside", () => {
    expect(loopTouches(square, box(200, 200))).toBe(false)
    expect(loopTouches(square.slice(0, 2), box(40, 0))).toBe(false)
  })

  it("names what it caught", () => {
    const elements = [
      { id: "in", ...box(40, 40) },
      { id: "out", ...box(300, 300) },
    ]
    expect(elementsInLoop(square, elements)).toEqual(["in"])
  })
})
