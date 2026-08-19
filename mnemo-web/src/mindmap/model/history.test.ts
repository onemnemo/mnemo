import { describe, expect, it } from "vitest"

import type { MindmapRestoreDelta } from "./delta"
import type { MindmapElement } from "./document"
import {
  canRedo,
  canUndo,
  emptyHistory,
  mergeDeltas,
  record,
  redo,
  settle,
  undo,
  undoLabel,
  type HistoryEntry,
} from "./history"

function node(id: string, text: string): MindmapElement {
  return { id, kind: "node", content: { $type: "text", text } }
}

function entry(over: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    undo: { removeElementIds: ["n1"] },
    redo: { elements: [node("n1", "one")] },
    label: "Add node",
    ...over,
  }
}

describe("recording a step", () => {
  it("pushes it onto the past and clears the redo branch", () => {
    const after = record(record(emptyHistory(), entry(), 1), entry({ label: "Rename" }), 2)
    const undone = undo(after)!.next

    expect(canRedo(undone)).toBe(true)
    const afterNewEdit = record(undone, entry({ label: "Delete" }), 3)
    expect(canRedo(afterNewEdit)).toBe(false)
    expect(undoLabel(afterNewEdit)).toBe("Delete")
  })

  it("drops a step that changed nothing, so a no-op click costs no undo press", () => {
    const state = record(emptyHistory(), entry({ undo: {}, redo: {} }), 1)

    expect(canUndo(state)).toBe(false)
  })

  it("still adopts the revision of a step that changed nothing", () => {
    // Setting a node to the text it already has is a real commit with an empty delta. A stack left
    // pointing at the revision before it would have every later undo refused as stale.
    const state = record(record(emptyHistory(), entry(), 4), entry({ undo: {}, redo: {} }), 5)

    expect(state.revision).toBe(5)
    expect(state.past).toHaveLength(1)
  })

  it("folds consecutive steps that share a coalesce key", () => {
    const first = record(
      emptyHistory(),
      entry({
        coalesceKey: "text:n1",
        undo: { elements: [node("n1", "")] },
        redo: { elements: [node("n1", "h")] },
        label: "Edit text",
      }),
      1,
    )
    const second = record(
      first,
      entry({
        coalesceKey: "text:n1",
        undo: { elements: [node("n1", "h")] },
        redo: { elements: [node("n1", "hi")] },
        label: "Edit text",
      }),
      2,
    )

    expect(second.past).toHaveLength(1)
    // One press reaches back past the whole group, not to the middle of the word.
    expect(second.past[0].undo.elements![0].content).toEqual({ $type: "text", text: "" })
    expect(second.past[0].redo.elements![0].content).toEqual({ $type: "text", text: "hi" })
    // The folded entry undoes back past the group, but from the newest revision, not the group's.
    expect(second.revision).toBe(2)
  })

  it("does not fold across a different key", () => {
    const first = record(emptyHistory(), entry({ coalesceKey: "text:n1" }), 1)
    const second = record(first, entry({ coalesceKey: "text:n2" }), 2)

    expect(second.past).toHaveLength(2)
  })

  it("does not fold when the key is absent", () => {
    const state = record(record(emptyHistory(), entry(), 1), entry(), 2)

    expect(state.past).toHaveLength(2)
  })
})

describe("the revision the stack is replayable against", () => {
  it("starts at the revision the document was loaded on", () => {
    expect(emptyHistory(17).revision).toBe(17)
  })

  it("moves to whatever a landed replay reported, without touching the entries", () => {
    // A replay is itself a write, so the deltas still describe the same document but the server
    // knows that document by a new number.
    const state = record(record(emptyHistory(3), entry(), 4), entry({ label: "Rename" }), 5)
    const step = undo(state)!
    const settled = settle(step.next, 6)

    expect(settled.revision).toBe(6)
    expect(settled.past).toEqual(step.next.past)
    expect(settled.future).toEqual(step.next.future)
  })
})

describe("undo and redo", () => {
  it("hand back the entry to replay without mutating until the caller says it landed", () => {
    const state = record(emptyHistory(), entry({ label: "Add node" }), 1)

    const step = undo(state)!
    expect(step.entry.label).toBe("Add node")
    // The original is untouched, which is what lets the caller leave the entry on the stack when a
    // restore is refused for a stale revision.
    expect(canUndo(state)).toBe(true)
    expect(canUndo(step.next)).toBe(false)
    expect(canRedo(step.next)).toBe(true)
  })

  it("carry the stack revision through, so a refused replay does not lose the basis", () => {
    const state = record(emptyHistory(3), entry(), 4)

    expect(undo(state)!.next.revision).toBe(4)
    expect(redo(undo(state)!.next)!.next.revision).toBe(4)
  })

  it("round-trip back to where they started", () => {
    const state = record(emptyHistory(), entry(), 1)
    const undone = undo(state)!.next
    const redone = redo(undone)!.next

    expect(canUndo(redone)).toBe(true)
    expect(canRedo(redone)).toBe(false)
  })

  it("are null at the ends", () => {
    expect(undo(emptyHistory())).toBeNull()
    expect(redo(emptyHistory())).toBeNull()
  })
})

describe("merging deltas", () => {
  it("lets the later value win on an overlap", () => {
    const merged = mergeDeltas({ elements: [node("a", "old")] }, { elements: [node("a", "new")] })

    expect(merged.elements).toHaveLength(1)
    expect(merged.elements![0].content).toEqual({ $type: "text", text: "new" })
  })

  it("drops an upsert the later delta removes rather than restoring it first", () => {
    const merged = mergeDeltas({ elements: [node("a", "one")] }, { removeElementIds: ["a"] })

    expect(merged.elements).toEqual([])
    expect(merged.removeElementIds).toEqual(["a"])
  })

  it("unions removals without duplicating them", () => {
    const first: MindmapRestoreDelta = { removeEdgeIds: ["e1", "e2"] }
    const second: MindmapRestoreDelta = { removeEdgeIds: ["e2", "e3"] }

    expect(mergeDeltas(first, second).removeEdgeIds).toEqual(["e1", "e2", "e3"])
  })

  it("keeps the document-level fields, taking the later one where both name it", () => {
    // A coalesced group used to drop these, which lost the title or the background it was undoing
    // back to while keeping every element it touched.
    const merged = mergeDeltas({ title: "before" }, { canvas: { background: "grid" } })

    expect(merged.title).toBe("before")
    expect(merged.canvas).toEqual({ background: "grid" })
    expect(mergeDeltas({ title: "before" }, { title: "after" }).title).toBe("after")
  })
})
