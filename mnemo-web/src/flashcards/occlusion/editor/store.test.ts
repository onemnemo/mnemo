import { describe, expect, it, vi } from "vitest"

import { buildOcclusionUnits, OCCLUSION_MAX_MASKS } from "../../facts/occlusion"
import { cardList } from "./cards"
import { moveMasks } from "./ops"
import { perform } from "./perform"
import { EDITOR_MAX_SCALE, EDITOR_MIN_SCALE, frameOf } from "./state"
import { createEditorStore } from "./store"
import { makeDoc, rect, trio } from "./test-kit"

const METRICS = { box: { w: 1200, h: 800 }, fitted: { w: 1000, h: 500 }, natural: { w: 4000, h: 2000 } }

function started(env = {}) {
  const store = createEditorStore(trio(), env)
  store.setMetrics(METRICS)
  return store
}

describe("committing and undoing", () => {
  it("a gesture previews a draft and commits one step", () => {
    const store = started()
    const base = store.getState().history.present
    store.preview(moveMasks(base, ["a"], 0.1, 0))
    store.preview(moveMasks(base, ["a"], 0.2, 0))
    expect(store.getState().history.past).toHaveLength(0)
    expect(store.doc().masks[0].x).toBeCloseTo(0.3, 4)

    store.commitDraft()
    expect(store.getState().history.past).toHaveLength(1)
    store.undo()
    expect(store.doc().masks[0].x).toBe(0.1)
    store.redo()
    expect(store.doc().masks[0].x).toBeCloseTo(0.3, 4)
  })

  it("cancelling a draft restores the committed document", () => {
    const store = started()
    store.preview(moveMasks(store.doc(), ["a"], 0.3, 0))
    store.cancelDraft()
    expect(store.doc().masks[0].x).toBe(0.1)
  })

  it("a gesture that ends where it began records nothing", () => {
    const store = started()
    store.preview(moveMasks(store.doc(), ["a"], 0.3, 0))
    store.preview(store.getState().history.present)
    store.commitDraft()
    expect(store.canUndo()).toBe(false)
  })

  it("tells the host about committed changes only", () => {
    const onChange = vi.fn()
    const store = started({ onChange })
    store.preview(moveMasks(store.doc(), ["a"], 0.1, 0))
    expect(onChange).not.toHaveBeenCalled()
    store.commitDraft()
    store.undo()
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it("folds a run of nudges into one undo step", () => {
    let clock = 1000
    const store = started({ now: () => (clock += 50) })
    store.select(["a"])
    for (let i = 0; i < 5; i++) perform(store, "nudge-right")
    expect(store.getState().history.past).toHaveLength(1)
    expect(store.doc().masks[0].x).toBeCloseTo(0.105, 4)
    store.undo()
    expect(store.doc().masks[0].x).toBe(0.1)
  })

  it("keeps the selection to masks that still exist after undo", () => {
    const store = started()
    store.addShape({ shape: "rect", x: 0.5, y: 0.5, w: 0.1, h: 0.1 })
    expect(store.getState().selection).toHaveLength(1)
    store.undo()
    expect(store.getState().selection).toEqual([])
  })
})

describe("the mask cap", () => {
  function full() {
    const masks = Array.from({ length: OCCLUSION_MAX_MASKS }, (_, i) => rect(`m${String(i).padStart(7, "0")}`, 0.1, 0.1, 0.05, 0.05))
    return makeDoc(...masks)
  }

  it("says so when a shape, a polygon or a duplicate would go past it", () => {
    const onFull = vi.fn()
    const store = createEditorStore(full(), { onFull })
    store.setMetrics(METRICS)

    expect(store.addShape({ shape: "rect", x: 0.1, y: 0.1, w: 0.1, h: 0.1 })).toBeNull()
    perform(store, "tool-polygon")
    store.addPoint([0.1, 0.1])
    store.addPoint([0.5, 0.1])
    store.addPoint([0.3, 0.6])
    expect(store.finishPolygon()).toBe(false)
    store.select([store.doc().masks[0].id])
    store.duplicateSelection()

    expect(onFull).toHaveBeenCalledTimes(3)
    expect(store.doc().masks).toHaveLength(OCCLUSION_MAX_MASKS)
  })
})

describe("ids", () => {
  it("never reuses the id of a deleted mask, and undo restores the same id", () => {
    let n = 0
    const store = started({ random: () => (n++ * 0.137) % 1 })
    store.select(["b"])
    store.deleteSelection()
    expect(store.doc().masks.map((m) => m.id)).toEqual(["a", "c"])

    const minted = [store.mint(), store.mint()]
    expect(new Set(minted).size).toBe(2)
    expect(minted).not.toContain("b")

    store.undo()
    expect(store.doc().masks.map((m) => m.id)).toEqual(["a", "b", "c"])
  })

  it("added shapes get an id that collides with no mask or group", () => {
    const store = createEditorStore(makeDoc())
    const ids = new Set<string>()
    for (let i = 0; i < 40; i++) {
      const id = store.addShape({ shape: "rect", x: 0.1, y: 0.1, w: 0.1, h: 0.1 })!
      expect(id.length).toBeGreaterThanOrEqual(8)
      ids.add(id)
    }
    expect(ids.size).toBe(40)
    expect(buildOcclusionUnits(store.doc()).collisions).toEqual([])
  })
})

describe("actions", () => {
  it("groups, ungroups and keeps keys valid, all through perform", () => {
    const store = started()
    perform(store, "select-all")
    perform(store, "group")
    expect(cardList(store.doc()).map((c) => c.key)).toEqual(["ma"])
    expect(store.getState().selection).toEqual(["a", "b", "c"])

    perform(store, "ungroup")
    expect(cardList(store.doc()).map((c) => c.key)).toEqual(["ma", "mb", "mc"])
    perform(store, "undo")
    expect(cardList(store.doc()).map((c) => c.key)).toEqual(["ma"])
    perform(store, "redo")
    expect(cardList(store.doc()).map((c) => c.key)).toEqual(["ma", "mb", "mc"])
  })

  it("duplicates and selects the copies", () => {
    const store = started()
    store.select(["a"])
    perform(store, "duplicate")
    expect(store.doc().masks).toHaveLength(4)
    expect(store.getState().selection).toHaveLength(1)
    expect(store.getState().selection[0]).not.toBe("a")
  })

  it("deletes the selection", () => {
    const store = started()
    store.select(["a", "b"])
    expect(perform(store, "delete")).toBe(true)
    expect(store.doc().masks.map((m) => m.id)).toEqual(["c"])
    expect(perform(store, "delete")).toBe(false)
  })

  it("moves cards earlier and later", () => {
    const store = started()
    store.select(["c"])
    perform(store, "move-earlier")
    expect(cardList(store.doc()).map((c) => c.key)).toEqual(["ma", "mc", "mb"])
    perform(store, "move-later")
    expect(cardList(store.doc()).map((c) => c.key)).toEqual(["ma", "mb", "mc"])
  })

  it("steps through masks with the bracket keys", () => {
    const store = started()
    perform(store, "next-mask")
    expect(store.getState().selection).toEqual(["a"])
    perform(store, "next-mask")
    perform(store, "previous-mask")
    expect(store.getState().selection).toEqual(["a"])
  })

  it("asks the host to rename the last selected mask", () => {
    const onRename = vi.fn()
    const store = started({ onRename })
    expect(perform(store, "rename")).toBe(false)
    store.select(["b"])
    perform(store, "rename")
    expect(onRename).toHaveBeenCalledWith("b")
  })

  it("changes the mode and renames", () => {
    const store = started()
    store.setMode("hideOne")
    store.rename("a", "Rough ER")
    expect(store.doc()).toMatchObject({ mode: "hideOne" })
    expect(store.doc().masks[0].label).toBe("Rough ER")
  })

  it("toggles show masks", () => {
    const store = started()
    perform(store, "toggle-masks")
    expect(store.getState().showMasks).toBe(true)
  })
})

describe("polygon drawing", () => {
  it("places points, removes the last, and finishes with three", () => {
    const store = started()
    perform(store, "tool-polygon")
    store.addPoint([0.1, 0.1])
    store.addPoint([0.3, 0.1])
    expect(perform(store, "finish-polygon")).toBe(false)

    store.addPoint([0.2, 0.3])
    store.addPoint([0.5, 0.5])
    perform(store, "delete")
    expect(store.getState().pending).toHaveLength(3)

    expect(perform(store, "finish-polygon")).toBe(true)
    expect(store.getState().pending).toBeNull()
    expect(store.doc().masks.at(-1)).toMatchObject({ shape: "polygon" })
    expect(store.getState().tool).toBe("polygon")
  })

  it("stops accepting points at the cap", () => {
    const store = started()
    for (let i = 0; i < 120; i++) store.addPoint([i / 200, 0.1])
    expect(store.getState().pending).toHaveLength(100)
  })
})

describe("escape", () => {
  it("cancels the shape, then the tool, then the selection, then falls through", () => {
    const store = started()
    store.select(["a"])
    perform(store, "tool-polygon")
    store.addPoint([0.1, 0.1])

    expect(perform(store, "cancel")).toBe(true)
    expect(store.getState().pending).toBeNull()
    expect(store.getState().tool).toBe("polygon")

    perform(store, "cancel")
    expect(store.getState().tool).toBe("select")
    expect(store.getState().selection).toEqual(["a"])

    perform(store, "cancel")
    expect(store.getState().selection).toEqual([])
    expect(perform(store, "cancel")).toBe(false)
  })

  it("cancels a drawing in flight first", () => {
    const store = started()
    store.preview(moveMasks(store.doc(), ["a"], 0.1, 0))
    perform(store, "cancel")
    expect(store.getState().draft).toBeNull()
  })
})

describe("zoom", () => {
  it("zooms in, out and back to fit", () => {
    const store = started()
    store.zoomIn()
    expect(store.getState().view.scale).toBeCloseTo(1.25, 4)
    store.zoomOut()
    expect(store.getState().view.scale).toBeCloseTo(1, 4)
    store.zoomIn()
    store.fit()
    expect(store.getState().view.scale).toBe(1)
  })

  it("reads the percentage as shown width over natural width", () => {
    const store = started()
    expect(store.zoomPercent()).toBe(25)
    store.zoomTo(100)
    expect(store.zoomPercent()).toBe(100)
    expect(store.getState().view.scale).toBeCloseTo(4, 3)
  })

  it("stops at the editor maximum", () => {
    const store = started()
    store.zoomBy(1000)
    expect(store.getState().view.scale).toBe(EDITOR_MAX_SCALE)
  })

  it("zooms out to half of fit and no further", () => {
    const store = started()
    store.zoomBy(0.001)
    expect(store.getState().view.scale).toBe(EDITOR_MIN_SCALE)
    expect(EDITOR_MIN_SCALE).toBe(0.5)
    store.zoomOut()
    expect(store.getState().view.scale).toBe(EDITOR_MIN_SCALE)
    expect(store.zoomPercent()).toBe(13)
  })

  it("steps down below fit with zoom out and returns to fit", () => {
    const store = started()
    store.zoomOut()
    expect(store.getState().view.scale).toBeCloseTo(0.8, 4)
    store.fit()
    expect(store.getState().view.scale).toBe(1)
  })

  it("keeps a view smaller than the pane centred through pan and wheel zoom", () => {
    const store = started()
    store.zoomBy(0.5, { x: 100, y: 50 })
    store.panByPixels(300, -200)
    const { view } = store.getState()
    expect(view).toEqual({ scale: 0.5, cx: 0.5, cy: 0.5 })
    expect(frameOf(store.getState())).toEqual({ x: 350, y: 275, w: 500, h: 250 })
  })

  it("does nothing before the stage has measured", () => {
    const store = createEditorStore(trio())
    store.zoomIn()
    expect(store.getState().view.scale).toBe(1)
  })

  it("pans a zoomed view", () => {
    const store = started()
    store.zoomTo(200)
    const before = store.getState().view.cx
    store.panByPixels(-100, 0)
    expect(store.getState().view.cx).toBeGreaterThan(before)
  })
})

describe("reset", () => {
  it("loads a different document with a clean history", () => {
    const store = started()
    store.select(["a"])
    store.deleteSelection()
    store.reset(makeDoc())
    expect(store.doc().masks).toEqual([])
    expect(store.canUndo()).toBe(false)
  })
})

describe("undo and redo bring the selection back", () => {
  it("reselects what a delete removed, then clears it on redo", () => {
    const store = started()
    store.select(["a", "b"])
    store.deleteSelection()
    expect(store.getState().selection).toEqual([])
    store.undo()
    expect(store.getState().selection).toEqual(["a", "b"])
    store.redo()
    expect(store.getState().selection).toEqual([])
  })

  it("reselects the whole group after undoing an ungroup that renamed a member", () => {
    const store = createEditorStore(makeDoc(rect("b", 0.2, 0, 0.1, 0.1, { group: "gone" }), rect("c", 0.4, 0, 0.1, 0.1, { group: "gone" })))
    store.select(["b", "c"])
    store.ungroupSelection()
    expect(store.doc().masks.map((m) => m.id)).toEqual(["gone", "c"])
    store.undo()
    expect(store.doc().masks.map((m) => m.id)).toEqual(["b", "c"])
    expect(store.getState().selection).toEqual(["b", "c"])
    store.redo()
    expect(store.getState().selection).toEqual(["gone", "c"])
  })

  it("selects the copy after redoing a duplicate and the source after undoing it", () => {
    const store = started()
    store.select(["a"])
    store.duplicateSelection()
    const copy = store.getState().selection[0]
    store.undo()
    expect(store.getState().selection).toEqual(["a"])
    store.redo()
    expect(store.getState().selection).toEqual([copy])
  })

  it("keeps the marks in line across a run of nudges folded into one step", () => {
    let clock = 0
    const store = started({ now: () => (clock += 10) })
    store.select(["a"])
    perform(store, "nudge-right")
    perform(store, "nudge-right")
    store.undo()
    expect(store.getState().selection).toEqual(["a"])
    expect(store.canUndo()).toBe(false)
  })
})

describe("an unfinished polygon", () => {
  it("keeps its points when the shape is a sliver", () => {
    const store = started()
    perform(store, "tool-polygon")
    for (const p of [[0.1, 0.5], [0.4, 0.5], [0.7, 0.5002]] as [number, number][]) store.addPoint(p)
    expect(perform(store, "finish-polygon")).toBe(false)
    expect(store.getState().pending).toHaveLength(3)
    expect(store.doc().masks).toHaveLength(3)

    store.removeLastPoint()
    store.addPoint([0.5, 0.8])
    expect(perform(store, "finish-polygon")).toBe(true)
  })
})

describe("cancelling a gesture", () => {
  it("is false with none in flight and true with one, clearing its draft", () => {
    const store = started()
    expect(store.cancelGesture()).toBe(false)
    store.beginGesture()
    store.preview(moveMasks(store.doc(), ["a"], 0.1, 0))
    expect(perform(store, "cancel")).toBe(true)
    expect(store.getState().draft).toBeNull()
    expect(store.getState().gesture.epoch).toBe(1)
  })
})

describe("selecting the same masks again", () => {
  it("does not notify listeners", () => {
    const store = started()
    store.select(["a"])
    let calls = 0
    store.subscribe(() => calls++)
    store.select(["a"])
    expect(calls).toBe(0)
  })
})
