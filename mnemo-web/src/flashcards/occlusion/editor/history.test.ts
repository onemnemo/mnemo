import { describe, expect, it } from "vitest"

import { canRedo, canUndo, COALESCE_MS, commit, createHistory, HISTORY_LIMIT, redo, undo } from "./history"

describe("history", () => {
  it("records, undoes and redoes", () => {
    let h = createHistory(0)
    h = commit(h, 1)
    h = commit(h, 2)
    expect([h.present, canUndo(h), canRedo(h)]).toEqual([2, true, false])

    h = undo(h)
    expect([h.present, canRedo(h)]).toEqual([1, true])
    h = undo(h)
    h = undo(h)
    expect(h.present).toBe(0)
    expect(canUndo(h)).toBe(false)

    h = redo(redo(h))
    expect(h.present).toBe(2)
    expect(redo(h)).toBe(h)
  })

  it("drops the redo branch on a new commit", () => {
    let h = commit(commit(createHistory(0), 1), 2)
    h = commit(undo(h), 9)
    expect(canRedo(h)).toBe(false)
    expect(undo(h).present).toBe(1)
  })

  it("does not record a commit that changes nothing", () => {
    const h = commit(createHistory(5), 6)
    expect(commit(h, 6)).toBe(h)
    const same = commit(createHistory({ n: 1 }), { n: 1 }, { equal: (a, b) => a.n === b.n })
    expect(canUndo(same)).toBe(false)
  })

  it("folds quick commits with one key into a single step", () => {
    let h = createHistory(0)
    h = commit(h, 1, { key: "nudge", at: 1000 })
    h = commit(h, 2, { key: "nudge", at: 1100 })
    h = commit(h, 3, { key: "nudge", at: 1200 })
    expect(h.past).toEqual([0])
    expect(undo(h).present).toBe(0)
  })

  it("starts a new step after the window, for another key, or without a key", () => {
    let h = commit(createHistory(0), 1, { key: "nudge", at: 1000 })
    h = commit(h, 2, { key: "nudge", at: 1000 + COALESCE_MS + 1 })
    expect(h.past).toEqual([0, 1])
    h = commit(h, 3, { key: "other", at: 1000 + COALESCE_MS + 2 })
    expect(h.past).toEqual([0, 1, 2])
    h = commit(h, 4)
    expect(h.past).toEqual([0, 1, 2, 3])
  })

  it("keeps at most the limit", () => {
    let h = createHistory(0)
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) h = commit(h, i)
    expect(h.past).toHaveLength(HISTORY_LIMIT)
    expect(h.past[0]).toBe(20)
  })
})
