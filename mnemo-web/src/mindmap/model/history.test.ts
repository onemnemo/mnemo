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
    const after = record(record(emptyHistory(), entry()), entry({ label: "Rename" }))
    const undone = undo(after)!.next

    expect(canRedo(undone)).toBe(true)
    const afterNewEdit = record(undone, entry({ label: "Delete" }))
    expect(canRedo(afterNewEdit)).toBe(false)
    expect(undoLabel(afterNewEdit)).toBe("Delete")
  })

  it("drops a step that changed nothing, so a no-op click costs no undo press", () => {
    const state = record(emptyHistory(), entry({ undo: {}, redo: {} }))

    expect(canUndo(state)).toBe(false)
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
    )
    const second = record(
      first,
      entry({
        coalesceKey: "text:n1",
        undo: { elements: [node("n1", "h")] },
        redo: { elements: [node("n1", "hi")] },
        label: "Edit text",
      }),
    )

    expect(second.past).toHaveLength(1)
    // One press reaches back past the whole group, not to the middle of the word.
    expect(second.past[0].undo.elements![0].content).toEqual({ $type: "text", text: "" })
    expect(second.past[0].redo.elements![0].content).toEqual({ $type: "text", text: "hi" })
  })

  it("does not fold across a different key", () => {
    const first = record(emptyHistory(), entry({ coalesceKey: "text:n1" }))
    const second = record(first, entry({ coalesceKey: "text:n2" }))

    expect(second.past).toHaveLength(2)
  })

  it("does not fold when the key is absent", () => {
    const state = record(record(emptyHistory(), entry()), entry())

    expect(state.past).toHaveLength(2)
  })
})

describe("undo and redo", () => {
  it("hand back the entry to replay without mutating until the caller says it landed", () => {
    const state = record(emptyHistory(), entry({ label: "Add node" }))

    const step = undo(state)!
    expect(step.entry.label).toBe("Add node")
    // The original is untouched, which is what lets the caller leave the entry on the stack when a
    // restore is refused for a stale revision.
    expect(canUndo(state)).toBe(true)
    expect(canUndo(step.next)).toBe(false)
    expect(canRedo(step.next)).toBe(true)
  })

  it("round-trip back to where they started", () => {
    const state = record(emptyHistory(), entry())
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
})
