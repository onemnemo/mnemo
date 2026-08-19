import { describe, expect, it } from "vitest"

import {
  adoptRevision,
  beginWrite,
  classify,
  endWrite,
  initialLiveRevision,
  type MindmapChangedNotice,
} from "./live-revision"

const MAP = "map-1"

function notice(revision: number, over: Partial<MindmapChangedNotice> = {}): MindmapChangedNotice {
  return { mapId: MAP, revision, kind: "edited", ...over }
}

/** A notice carrying the write whole, which is the only kind that can be folded. */
function carried(revision: number, baseRevision: number): MindmapChangedNotice {
  return notice(revision, {
    baseRevision,
    undo: { removeElementIds: ["n1"] },
    redo: { elements: [{ id: "n1", kind: "node", content: { $type: "text", text: "one" } }] },
    order: { elements: ["n1"], edges: [] },
  })
}

describe("a change notice", () => {
  it("is ignored when it names another map", () => {
    expect(classify(initialLiveRevision(3), notice(9, { mapId: "other" }), MAP)).toBe("ignore")
  })

  it("closes the editor when the map was deleted", () => {
    expect(classify(initialLiveRevision(3), notice(4, { kind: "deleted" }), MAP)).toBe("closed")
  })

  it("is ignored when it describes a revision we already have", () => {
    expect(classify(initialLiveRevision(7), notice(7), MAP)).toBe("ignore")
    expect(classify(initialLiveRevision(7), notice(6), MAP)).toBe("ignore")
  })

  it("reloads when someone else moved the map on without saying what they did", () => {
    expect(classify(initialLiveRevision(7), notice(8), MAP)).toBe("reload")
  })

  it("folds someone else's write when it arrives whole and applied against what we hold", () => {
    // This is the assistant or an import editing the open map. Folding is what makes that one
    // Ctrl+Z to take back, rather than a refetch that empties the undo stack.
    expect(classify(initialLiveRevision(7), carried(8, 7), MAP)).toBe("fold")
  })

  it("reloads rather than folding a write that applied against a revision we never held", () => {
    // The delta is a verbatim rewrite of named ids. Applied to a different document it does not
    // fail, it succeeds and writes something neither side ever had.
    expect(classify(initialLiveRevision(7), carried(9, 8), MAP)).toBe("reload")
  })

  it("reloads when a carried notice is missing any of the three pieces a fold needs", () => {
    const whole = carried(8, 7)

    expect(classify(initialLiveRevision(7), { ...whole, undo: null }, MAP)).toBe("reload")
    expect(classify(initialLiveRevision(7), { ...whole, redo: null }, MAP)).toBe("reload")
    expect(classify(initialLiveRevision(7), { ...whole, order: null }, MAP)).toBe("reload")
  })

  it("does not fold a rename it can only half apply", () => {
    // A rename that fell back to a bare notice has no title to put anywhere; refetching is the only
    // way to learn the new one.
    expect(classify(initialLiveRevision(7), notice(8, { kind: "renamed" }), MAP)).toBe("reload")
    expect(classify(initialLiveRevision(7), carried(8, 7), MAP)).toBe("fold")
  })

  it("will not fold while one of our own writes is still out", () => {
    // That write is about to move the document under us. Absorbing another one first would leave
    // its answer describing a revision it never saw.
    const state = beginWrite(initialLiveRevision(7))

    expect(classify(state, carried(9, 8), MAP)).toBe("reload")
  })

  it("is ignored when it is the echo of a write still in flight", () => {
    // The push beats our own response back. Reloading here races that response and throws away the
    // optimistic state it is about to reconcile.
    const state = beginWrite(initialLiveRevision(7))

    expect(classify(state, notice(8), MAP)).toBe("ignore")
  })

  it("still reloads for a genuine interleave during our own write", () => {
    // Two revisions ahead while one write is out means someone else committed too; the write's own
    // response will report the same interleave, so both paths agree on a refetch.
    const state = beginWrite(initialLiveRevision(7))

    expect(classify(state, notice(9), MAP)).toBe("reload")
  })

  it("stops being ignored once the write it belonged to has landed", () => {
    let state = beginWrite(initialLiveRevision(7))
    state = endWrite(state, 8)

    expect(state.inFlight).toBe(0)
    expect(classify(state, notice(8), MAP)).toBe("ignore")
    expect(classify(state, notice(9), MAP)).toBe("reload")
  })

  it("adopts the revision a rejected write reported, so its notice is not read as news", () => {
    // A conflict body carries the revision the map is actually on. Without adopting it the very
    // next push would look like an unseen change and trigger a second, pointless reload.
    let state = beginWrite(initialLiveRevision(7))
    state = endWrite(state, 12)

    expect(classify(state, notice(12), MAP)).toBe("ignore")
  })

  it("never walks the known revision backwards", () => {
    let state = adoptRevision(initialLiveRevision(7), 11)
    state = adoptRevision(state, 9)

    expect(state.known).toBe(11)
  })

  it("does not let an unmatched write completion drive the in-flight count negative", () => {
    const state = endWrite(initialLiveRevision(7), 8)

    expect(state.inFlight).toBe(0)
  })
})
