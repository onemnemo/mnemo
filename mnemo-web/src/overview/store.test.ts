/**
 * The edit-mode transition table, one test per row, asserted on the layout DTO.
 *
 * The DTO is what gets written and what a later refactor must not change, so these tests read the
 * board through buildLayout rather than through the store's fields: how the draft is held is an
 * implementation detail, what it serialises to is the contract.
 *
 * Writes are recorded through the injected sink instead of going anywhere, which is the only way
 * "this mutation persisted immediately" and "this one waited for Done" are distinguishable at all.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

import type { OverviewLayoutDto } from "@/api/types"

import { buildLayout, useOverviewStore } from "./store"
import type { ManifestLookup, WidgetManifest } from "./widgets/manifest"

function manifestOf(widgetId: string, supportedSizes: WidgetManifest["supportedSizes"]): WidgetManifest {
  return {
    widgetId,
    ns: "Overview",
    author: "Mnemo",
    category: "study",
    icon: "square-stack",
    supportedSizes,
    defaultSize: supportedSizes[0],
  }
}

const MANIFESTS: Record<string, WidgetManifest> = {
  // The starter template's six, so a seed in these tests produces the board the app would seed.
  "mnemo.today": manifestOf("mnemo.today", [
    { columns: 2, rows: 1 },
    { columns: 4, rows: 1 },
  ]),
  "mnemo.streak": manifestOf("mnemo.streak", [
    { columns: 1, rows: 1 },
    { columns: 2, rows: 1 },
  ]),
  "mnemo.flashcard-memory": manifestOf("mnemo.flashcard-memory", [
    { columns: 1, rows: 1 },
    { columns: 2, rows: 1 },
  ]),
  "mnemo.recent": manifestOf("mnemo.recent", [
    { columns: 2, rows: 1 },
    { columns: 2, rows: 2 },
  ]),
  "mnemo.forecast": manifestOf("mnemo.forecast", [
    { columns: 2, rows: 1 },
    { columns: 4, rows: 1 },
  ]),
  "mnemo.activity": manifestOf("mnemo.activity", [
    { columns: 2, rows: 1 },
    { columns: 2, rows: 2 },
  ]),

  // Two more to add from the library, one of which carries a settings schema so the seeded bag
  // and the config merge have something to act on.
  "mnemo.recent-notes": {
    ...manifestOf("mnemo.recent-notes", [
      { columns: 2, rows: 2 },
      { columns: 4, rows: 2 },
    ]),
    settings: [{ key: "limit", labelKey: "SettingLimit", type: "range", defaultValue: "5" }],
  },
  "mnemo.usage-summary": manifestOf("mnemo.usage-summary", [
    { columns: 1, rows: 2 },
    { columns: 2, rows: 2 },
  ]),
}

const lookup: ManifestLookup = (widgetId) => MANIFESTS[widgetId]

/**
 * A stored board with two things wrong with it on purpose: the widgets arrive in the wrong array
 * order for their `order` fields, and the second one carries a 3x1 its manifest stopped offering.
 */
const STORED: OverviewLayoutDto = {
  schemaVersion: 3,
  profileId: "default",
  widgets: [
    {
      instanceId: "recent",
      widgetId: "mnemo.recent",
      size: { columns: 3, rows: 1 },
      column: 2,
      row: 0,
      order: 1,
      settings: {},
    },
    {
      instanceId: "today",
      widgetId: "mnemo.today",
      size: { columns: 2, rows: 1 },
      column: 0,
      row: 0,
      order: 0,
      settings: { range: "week" },
    },
  ],
}

interface RecordedSave {
  layout: OverviewLayoutDto
  sessionId: number
}

let saves: RecordedSave[]
let ids: number

const store = () => useOverviewStore.getState()
const dto = () => buildLayout(useOverviewStore.getState())

/** Puts the store on a loaded board with nothing recorded yet, the starting point for most rows. */
function loadStored(): void {
  store().layoutLoaded(STORED)
  saves = []
}

beforeEach(() => {
  saves = []
  ids = 0
  // The store is a singleton; leaving Overview is the reset the module already has to have.
  store().leaveOverview()
  store().configure({
    manifest: lookup,
    newInstanceId: () => `added-${++ids}`,
    save: (layout, sessionId) => saves.push({ layout, sessionId }),
  })
})

describe("transition table", () => {
  // Row 1 | loading -> view
  it("layout GET resolves a board", () => {
    store().layoutLoaded(STORED)

    expect(store().boardState).toBe("ready")
    expect(dto()).toEqual({
      schemaVersion: 3,
      profileId: "default",
      widgets: [
        {
          instanceId: "today",
          widgetId: "mnemo.today",
          size: { columns: 2, rows: 1 },
          column: 0,
          row: 0,
          order: 0,
          settings: { range: "week" },
        },
        {
          // Snapped client-side from the stored 3x1: the Host has no manifest to do it with.
          instanceId: "recent",
          widgetId: "mnemo.recent",
          size: { columns: 2, rows: 1 },
          column: 2,
          row: 0,
          order: 1,
          settings: {},
        },
      ],
    })
    // Snapping is not worth a write of its own; it rides along on the next real save.
    expect(saves).toEqual([])
  })

  // Row 1, second half: a widget this build does not have keeps the row it came from intact.
  it("layout GET resolves a board holding an unknown widget id", () => {
    const withUnknown: OverviewLayoutDto = {
      ...STORED,
      widgets: [
        {
          instanceId: "gone",
          widgetId: "ext.acme.pomodoro",
          size: { columns: 7, rows: 3 },
          column: 1,
          row: 4,
          order: 0,
          settings: { mode: "long" },
        },
      ],
    }

    store().layoutLoaded(withUnknown)

    expect(dto().widgets[0]).toEqual(withUnknown.widgets[0])
    expect(saves).toEqual([])
  })

  // Row 2 | loading -> view
  it("layout GET resolves null", () => {
    store().layoutMissing()

    expect(store().boardState).toBe("ready")
    expect(dto().widgets.map((w) => [w.widgetId, w.column, w.row, w.order])).toEqual([
      ["mnemo.today", 0, 0, 0],
      ["mnemo.streak", 0, 1, 1],
      ["mnemo.flashcard-memory", 1, 1, 2],
      ["mnemo.recent", 2, 1, 3],
      ["mnemo.forecast", 0, 2, 4],
      ["mnemo.activity", 2, 2, 5],
    ])
    // The one load path that writes: the starter board must exist on disk after the first visit.
    expect(saves).toHaveLength(1)
    expect(saves[0].layout).toEqual(dto())

    // The same answer arriving a second time is not a second starter board: the board is no longer
    // loading, so there is nothing left for a seed to be the answer to.
    const seeded = dto()
    store().layoutMissing()
    expect(dto()).toEqual(seeded)
    expect(saves).toHaveLength(1)
  })

  // Row 2, second half: a never-saved profile in a store whose manifest lookup is not wired up.
  it("layout GET resolves null with nothing registered to seed from", () => {
    const reported = vi.spyOn(console, "error").mockImplementation(() => {})
    store().configure({ manifest: () => undefined })

    store().layoutMissing()

    // An empty board on screen is recoverable; an empty row on disk is not, because it reads back
    // as a board the user cleared and the real starter board would never seed again.
    expect(store().boardState).toBe("ready")
    expect(dto().widgets).toEqual([])
    expect(saves).toEqual([])
    expect(reported).toHaveBeenCalled()
    reported.mockRestore()
  })

  // Row 3 | loading -> error
  it("layout GET fails", () => {
    store().layoutFailed()

    expect(store().boardState).toBe("error")
    expect(dto().widgets).toEqual([])
    expect(saves).toEqual([])
  })

  // Row 4 | error -> loading
  it("retry", () => {
    store().layoutFailed()
    store().retryLoad()

    expect(store().boardState).toBe("loading")
    expect(dto().widgets).toEqual([])
    expect(saves).toEqual([])
  })

  // Row 5 | view -> edit
  it("Customize button", () => {
    loadStored()
    const committed = dto()

    store().enterEdit()

    expect(store().isEditMode).toBe(true)
    // The snapshot is the committed board, deep cloned, with order re-derived from list position.
    expect(store().snapshot).toEqual(committed)
    expect(store().snapshot).not.toBe(committed)
    expect(saves).toEqual([])
  })

  // Row 6 | view -> edit
  it("EmptyState Add First Widget", () => {
    // The empty state only renders outside edit mode, so this is a view-mode way into the library.
    store().layoutLoaded({ ...STORED, widgets: [] })
    saves = []

    store().openLibrary()

    expect(store().isEditMode).toBe(true)
    expect(store().isLibraryOpen).toBe(true)
    expect(dto().widgets).toEqual([])
    expect(saves).toEqual([])
  })

  // Row 7 | view/edit -> edit
  it("Add widget button", () => {
    loadStored()

    store().openLibrary()
    expect(store().isEditMode).toBe(true)
    expect(store().isLibraryOpen).toBe(true)

    // From inside an edit session it must not re-snapshot, or a second Add would make the draft
    // so far uncancellable.
    const snapshot = store().snapshot
    store().removeWidget("recent")
    store().closeLibrary()
    store().openLibrary()

    expect(store().snapshot).toEqual(snapshot)
    expect(store().snapshot?.widgets.map((w) => w.instanceId)).toEqual(["today", "recent"])
    expect(saves).toEqual([])
  })

  // Row 8 | edit -> edit
  it("size chip click", () => {
    loadStored()
    store().enterEdit()

    store().resizeWidget("today", { columns: 4, rows: 1 })
    expect(dto().widgets[0].size).toEqual({ columns: 4, rows: 1 })

    // Not in supportedSizes: a silent no-op, not a clamp and not a throw.
    store().resizeWidget("today", { columns: 3, rows: 3 })
    expect(dto().widgets[0].size).toEqual({ columns: 4, rows: 1 })

    expect(saves).toEqual([])
  })

  // Row 9 | edit -> edit
  it("remove (x)", () => {
    loadStored()
    store().enterEdit()

    store().removeWidget("today")

    expect(dto().widgets.map((w) => [w.instanceId, w.order])).toEqual([["recent", 0]])
    expect(saves).toEqual([])
  })

  // Row 10 | edit -> edit
  it("library Add", () => {
    loadStored()
    store().enterEdit()

    store().addWidget(MANIFESTS["mnemo.recent-notes"])

    expect(dto().widgets[2]).toEqual({
      instanceId: "added-1",
      widgetId: "mnemo.recent-notes",
      size: { columns: 2, rows: 2 },
      // Unassigned until the engine places it, unlike a seeded tile.
      column: -1,
      row: -1,
      order: 2,
      settings: { limit: "5" },
    })
    expect(saves).toEqual([])
  })

  // Row 11 | edit -> edit
  it("gear -> Save in config modal", () => {
    loadStored()
    store().enterEdit()

    store().applyConfig("today", { range: "month" })

    expect(dto().widgets[0].settings).toEqual({ range: "month" })
    expect(saves).toEqual([])
  })

  // Row 12 | edit -> edit (dragging)
  it("drag press on a tile", () => {
    loadStored()

    // Drag substate exists only inside an edit session, so the same press in view mode is nothing.
    store().beginDrag("recent")
    expect(store().dragged).toBeNull()
    expect(store().dragPosition).toBeNull()

    store().enterEdit()
    const before = dto()

    store().beginDrag("recent")

    expect(store().dragged).toBe("recent")
    expect(store().dragOrigin).toEqual({ column: 2, row: 0 })
    expect(store().anchorIndex).toBe(1)
    // Position stays null until the gesture reports one, so the tile keeps its placed rect for
    // that first frame rather than jumping to a corner nobody grabbed it by.
    expect(store().dragPosition).toBeNull()
    // Pressing the tile has not moved anything yet.
    expect(dto()).toEqual(before)
    expect(saves).toEqual([])
  })

  // Row 13 | edit (dragging) -> edit (dragging)
  it("pointer move", () => {
    loadStored()
    store().enterEdit()
    store().beginDrag("recent")

    store().updateDragPosition(120, 48)
    store().updateDragTarget(0, 3)

    // The target cell is written straight onto the tile, which is what re-runs placement.
    expect(dto().widgets[1]).toMatchObject({ instanceId: "recent", column: 0, row: 3 })
    expect(store().dragPosition).toEqual({ x: 120, y: 48 })
    // The origin is kept for the whole gesture, because Escape still has to undo it.
    expect(store().dragOrigin).toEqual({ column: 2, row: 0 })
    expect(saves).toEqual([])
  })

  // Row 14 | edit (dragging) -> edit
  it("pointer release", () => {
    loadStored()
    store().enterEdit()
    store().beginDrag("recent")
    store().updateDragTarget(0, 3)

    // The board the user was looking at when the pointer came up, every tile included. Committing
    // only the dragged one would let it lose the cell the ghost had just promised: while it is
    // held it is placed first and wins any cell, and the moment it stops being the anchor the
    // ordinary (row, column) order applies again.
    store().completeDrag({
      kind: "grid",
      cells: [
        { column: 0, row: 3 },
        { column: 2, row: 0 },
      ],
    })

    expect(dto().widgets[0]).toMatchObject({ instanceId: "today", column: 0, row: 3 })
    expect(dto().widgets[1]).toMatchObject({ instanceId: "recent", column: 2, row: 0 })
    expect(store().dragged).toBeNull()
    expect(store().anchorIndex).toBe(-1)
    expect(store().dragPosition).toBeNull()
    // A dropped tile is still only a draft; Done is what writes the cell it landed on.
    expect(saves).toEqual([])
  })

  it("pointer release below the widest breakpoint reorders instead of writing coordinates", () => {
    loadStored()
    store().enterEdit()
    const before = dto().widgets.map((widget) => widget.instanceId)
    store().beginDrag("recent")
    store().updateDragTarget(0, 3)

    store().completeDrag({ kind: "flow", index: 0 })

    // The coordinates the drag wrote are put back: below four columns they describe a grid that is
    // not on screen, and keeping them would throw away the layout authored at the widest one.
    const decks = dto().widgets.find((widget) => widget.instanceId === "recent")
    expect(decks).toMatchObject({ column: 2, row: 0 })
    // What the drop did express is order, and that is what changed.
    expect(dto().widgets.map((widget) => widget.instanceId)).toEqual(["recent", ...before.filter((id) => id !== "recent")])
    expect(store().dragged).toBeNull()
    expect(saves).toEqual([])
  })

  // Row 15 | edit (dragging) -> edit
  it("Escape, or pointer capture lost", () => {
    loadStored()
    store().enterEdit()
    const before = dto()
    store().beginDrag("recent")
    store().updateDragTarget(0, 3)

    store().cancelDrag()

    expect(dto()).toEqual(before)
    expect(store().dragged).toBeNull()
    expect(store().dragOrigin).toEqual({ column: -1, row: -1 })
    expect(store().anchorIndex).toBe(-1)
    expect(store().dragPosition).toBeNull()
    expect(saves).toEqual([])
  })

  // Row 16 | edit -> view
  it("Done", () => {
    loadStored()
    store().enterEdit()
    store().openLibrary()
    store().removeWidget("today")
    store().addWidget(MANIFESTS["mnemo.recent-notes"])
    store().beginDrag("recent")
    store().updateDragTarget(1, 1)

    store().done()

    expect(store().isEditMode).toBe(false)
    expect(store().snapshot).toBeNull()
    expect(store().isLibraryOpen).toBe(false)
    // Done cancels a drag still in flight rather than committing a cell nobody released on.
    expect(store().dragged).toBeNull()

    expect(saves).toHaveLength(1)
    expect(saves[0].layout).toEqual(dto())
    // `order` comes from list position, never from the value the instance was carrying: `decks`
    // arrived as order 1 and is now the first widget on the board.
    expect(saves[0].layout.widgets.map((w) => [w.instanceId, w.order])).toEqual([
      ["recent", 0],
      ["added-1", 1],
    ])
    expect(saves[0].layout.widgets[0]).toMatchObject({ column: 2, row: 0 })
  })

  // Row 17 | edit -> view
  it("Escape (not dragging)", () => {
    loadStored()
    const committed = dto()

    store().enterEdit()
    // Every mutation class at once, because Cancel is not an undo stack: it throws the whole draft
    // away, so a partial revert would show up here and nowhere else.
    store().addWidget(MANIFESTS["mnemo.usage-summary"])
    store().removeWidget("today")
    store().resizeWidget("recent", { columns: 2, rows: 2 })
    store().applyConfig("recent", { sort: "recent" })
    store().beginDrag("recent")
    store().updateDragTarget(3, 5)
    store().completeDrag({ kind: "grid", cells: [{ column: 3, row: 5 }, { column: 0, row: 0 }, { column: 1, row: 1 }] })
    expect(dto()).not.toEqual(committed)

    store().cancelEdit()

    expect(store().isEditMode).toBe(false)
    expect(store().snapshot).toBeNull()
    expect(store().isLibraryOpen).toBe(false)
    expect(dto()).toEqual(committed)
    expect(JSON.stringify(dto())).toBe(JSON.stringify(committed))
    // The persisted board was never touched during the session, so there is nothing to undo on it.
    expect(saves).toEqual([])
  })

  // Row 18 | edit -> (destroyed)
  it("navigate away", () => {
    loadStored()
    store().enterEdit()
    store().removeWidget("today")
    const abandonedSession = store().sessionId

    store().leaveOverview()

    expect(store().boardState).toBe("loading")
    expect(store().isEditMode).toBe(false)
    expect(store().snapshot).toBeNull()
    expect(dto().widgets).toEqual([])
    expect(saves).toEqual([])
    // A write the abandoned session managed to queue is identifiable by the id it carries, so a
    // response landing after this point can be dropped instead of applied.
    expect(store().sessionId).not.toBe(abandonedSession)
  })

  // Row 19 | view -> view
  it("resize / remove / add / config-save outside edit mode", () => {
    loadStored()

    store().resizeWidget("today", { columns: 4, rows: 1 })
    store().applyConfig("today", { range: "month" })
    store().addWidget(MANIFESTS["mnemo.recent-notes"])
    store().removeWidget("recent")

    expect(store().isEditMode).toBe(false)
    expect(saves).toHaveLength(4)
    // Each write carries the board as of that mutation, not just the last one.
    expect(saves[0].layout.widgets[0].size).toEqual({ columns: 4, rows: 1 })
    expect(saves[1].layout.widgets[0].settings).toEqual({ range: "month" })
    expect(saves[2].layout.widgets.map((w) => w.instanceId)).toEqual(["today", "recent", "added-1"])
    expect(saves[3].layout.widgets.map((w) => [w.instanceId, w.order])).toEqual([
      ["today", 0],
      ["added-1", 1],
    ])
  })
})

/**
 * Not a row on the desktop's table: there the board is repopulated only by the one-shot load and by
 * Cancel. On the web every immediate write invalidates the layout query, so a refetch can answer
 * while the user is mid-edit, and pressing Customize first is all it takes.
 */
describe("a load landing mid-edit", () => {
  it("leaves the edit session holding the board", () => {
    loadStored()
    store().enterEdit()
    store().removeWidget("today")
    const editing = dto()
    const snapshot = store().snapshot

    store().layoutLoaded(STORED)

    expect(store().isEditMode).toBe(true)
    expect(dto()).toEqual(editing)
    // The snapshot has to keep describing the board the session started from, or Cancel would
    // restore something the user never saw.
    expect(store().snapshot).toEqual(snapshot)

    store().done()

    expect(saves).toHaveLength(1)
    expect(saves[0].layout.widgets.map((w) => w.instanceId)).toEqual(["recent"])
  })

  it("is applied again once the session is over", () => {
    loadStored()
    store().enterEdit()
    store().removeWidget("today")
    store().cancelEdit()

    store().layoutLoaded({ ...STORED, widgets: [STORED.widgets[1]] })

    expect(dto().widgets.map((w) => w.instanceId)).toEqual(["today"])
  })
})

describe("an unreadable board", () => {
  // The stored row is intact and unknown to us. Writing the empty draft over it is the one
  // outcome that turns a transient read failure into permanent data loss.
  beforeEach(() => {
    store().layoutFailed()
  })

  it("cannot be written to by any mutation", () => {
    store().addWidget(MANIFESTS["mnemo.recent-notes"])
    store().removeWidget("today")
    store().resizeWidget("today", { columns: 4, rows: 1 })
    store().applyConfig("today", { range: "month" })

    expect(dto().widgets).toEqual([])
    expect(saves).toEqual([])
  })

  it("cannot be edited, so Done has nothing to commit", () => {
    store().enterEdit()
    store().openLibrary()

    expect(store().isEditMode).toBe(false)
    expect(store().isLibraryOpen).toBe(false)

    store().done()

    expect(saves).toEqual([])
  })

  it("stays in error until a retry, and the retry itself writes nothing", () => {
    store().enterEdit()
    store().done()
    store().cancelEdit()
    expect(store().boardState).toBe("error")

    store().retryLoad()

    expect(store().boardState).toBe("loading")
    expect(saves).toEqual([])
  })

  it("does not seed defaults over the board it failed to read", () => {
    // Seeding is the never-saved answer's response, and a read that failed did not give it. The
    // store is what has to refuse this, because nothing outside it knows that the row it could not
    // read is still there.
    store().layoutMissing()

    expect(store().boardState).toBe("error")
    expect(dto().widgets).toEqual([])
    expect(saves).toEqual([])
  })

  it("seeds only once a retry has put the load back in flight", () => {
    store().retryLoad()
    store().layoutMissing()

    expect(store().boardState).toBe("ready")
    expect(dto().widgets).toHaveLength(6)
    expect(saves).toHaveLength(1)
  })
})

describe("a store with no save sink", () => {
  it("reports the dropped write instead of swallowing it", async () => {
    // A fresh module instance: the singleton every other test uses is configured in beforeEach and
    // there is no way back to the defaults from outside.
    vi.resetModules()
    const { useOverviewStore: unconfigured } = await import("./store")
    unconfigured.getState().configure({ manifest: lookup, newInstanceId: () => "seeded" })
    const reported = vi.spyOn(console, "error").mockImplementation(() => {})

    unconfigured.getState().layoutMissing()

    expect(unconfigured.getState().boardState).toBe("ready")
    expect(reported).toHaveBeenCalled()
    reported.mockRestore()
  })
})

describe("the write itself", () => {
  it("refuses a board that is not the one we read", () => {
    // Forced into a state no transition produces, because that is the point: every mutation
    // already refuses to run on an unreadable board, and this is what still has to hold if some
    // later action forgets to. The guard belongs at the write, not only at the entrances.
    loadStored()
    store().enterEdit()
    store().removeWidget("today")
    useOverviewStore.setState({ boardState: "error" })

    store().done()

    expect(saves).toEqual([])
  })
})

describe("writes across sessions", () => {
  it("key each write to the session that issued it", () => {
    loadStored()
    store().removeWidget("recent")
    const first = saves[0].sessionId

    store().leaveOverview()
    loadStored()
    store().removeWidget("recent")

    expect(saves).toHaveLength(1)
    expect(saves[0].sessionId).not.toBe(first)
  })
})
