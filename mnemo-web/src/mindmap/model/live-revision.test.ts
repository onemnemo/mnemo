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

  it("reloads when someone else moved the map on", () => {
    expect(classify(initialLiveRevision(7), notice(8), MAP)).toBe("reload")
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
