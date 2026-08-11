import { describe, expect, it } from "vitest"

import {
  addElements,
  EMPTY_SELECTION,
  isSelected,
  retain,
  selectElements,
  selectionSize,
  selectOnly,
  toggle,
} from "./selection"

describe("selecting one thing", () => {
  it("drops everything else", () => {
    const both = toggle(selectOnly("element", "a"), "edge", "e1")
    const next = selectOnly("element", "b")

    expect([...next.elements]).toEqual(["b"])
    expect(next.edges.size).toBe(0)
    expect(selectionSize(both)).toBe(2)
  })

  it("points the primary at what was clicked", () => {
    expect(selectOnly("edge", "e1").primary).toEqual({ kind: "edge", id: "e1" })
  })
})

describe("toggling", () => {
  it("adds what is absent and removes what is present", () => {
    const one = toggle(EMPTY_SELECTION, "element", "a")
    expect(isSelected(one, "element", "a")).toBe(true)
    expect(isSelected(toggle(one, "element", "a"), "element", "a")).toBe(false)
  })

  it("moves the primary onto the addition", () => {
    const two = toggle(selectOnly("element", "a"), "element", "b")
    expect(two.primary).toEqual({ kind: "element", id: "b" })
  })

  it("hands the primary to a survivor when the primary itself is removed", () => {
    // Otherwise a contextual bar keeps reading values off something no longer selected.
    const two = toggle(selectOnly("element", "a"), "element", "b")
    const back = toggle(two, "element", "b")

    expect(back.primary).toEqual({ kind: "element", id: "a" })
  })

  it("leaves no primary when the last thing goes", () => {
    expect(toggle(selectOnly("element", "a"), "element", "a").primary).toBeNull()
  })

  it("keeps elements and edges apart", () => {
    const mixed = toggle(selectOnly("element", "a"), "edge", "a")

    expect([...mixed.elements]).toEqual(["a"])
    expect([...mixed.edges]).toEqual(["a"])
  })
})

describe("a marquee's release", () => {
  it("replaces on its own and adds when it is additive", () => {
    const first = selectElements(["a", "b"])
    expect([...selectElements(["c"]).elements]).toEqual(["c"])
    expect([...addElements(first, ["c"]).elements]).toEqual(["a", "b", "c"])
  })

  it("catches nothing without clearing the primary out from under an empty result", () => {
    expect(selectElements([]).primary).toBeNull()
  })
})

describe("retaining across a document change", () => {
  it("drops ids the document no longer has", () => {
    const before = addElements(selectOnly("element", "a"), ["b"])
    const after = retain(
      before,
      (id) => id === "a",
      () => true,
    )

    expect([...after.elements]).toEqual(["a"])
    expect(after.primary).toEqual({ kind: "element", id: "a" })
  })

  it("returns the same value when nothing was dropped", () => {
    // Identity matters: this runs on every scene change, and a fresh object would restart the
    // effects that depend on the selection.
    const before = selectElements(["a", "b"])
    expect(
      retain(
        before,
        () => true,
        () => true,
      ),
    ).toBe(before)
  })

  it("falls back to an edge when every element went", () => {
    const mixed = toggle(selectOnly("element", "a"), "edge", "e1")
    const after = retain(
      mixed,
      () => false,
      () => true,
    )

    expect(after.primary).toEqual({ kind: "edge", id: "e1" })
  })
})
