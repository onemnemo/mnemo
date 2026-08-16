// @vitest-environment jsdom
/**
 * The drag gesture end to end, driven with real window events against the real store.
 *
 * Assertions are on the draft's coordinates rather than on anything rendered, for the same reason
 * the store's own tests assert on the DTO: where a tile ends up is the contract, and the pixels are
 * one renderer's opinion about it.
 */

import { act, useRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { OverviewLayoutDto } from "@/api/types"

import { computePlacements } from "../layout/compute"
import { useOverviewStore } from "../store"
import type { ManifestLookup, WidgetManifest } from "../widgets/manifest"
import { useBoardDrag, type BoardDrag } from "./useBoardDrag"

// A four-column board at the widest breakpoint: 1040px of content is 248px per column once the
// three 16px gaps come out, so column c starts at c * 264 and row r at r * 136.
const BOARD_LEFT = 100
const BOARD_TOP = 50
const BOARD_WIDTH = 1040

/** The grid the harness lays out in. A test can narrow it before starting a gesture. */
let grid = { columnCount: 4, usedRows: 1 }

function manifestOf(widgetId: string): WidgetManifest {
  const supportedSizes = [{ columns: 2, rows: 1 }]
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

const lookup: ManifestLookup = (widgetId) =>
  widgetId === "mnemo.today" || widgetId === "mnemo.recent" ? manifestOf(widgetId) : undefined

/** Two 2x1 tiles side by side on the top row. */
const STORED: OverviewLayoutDto = {
  schemaVersion: 3,
  profileId: "default",
  widgets: [
    { instanceId: "a", widgetId: "mnemo.today", size: { columns: 2, rows: 1 }, column: 0, row: 0, order: 0, settings: {} },
    { instanceId: "b", widgetId: "mnemo.recent", size: { columns: 2, rows: 1 }, column: 2, row: 0, order: 1, settings: {} },
  ],
}

let drag: BoardDrag | null = null
let root: Root | null = null
let container: HTMLDivElement | null = null
/** Stands in for the tile element the press lands on, so the hook can measure the grab offset. */
let tile: HTMLDivElement | null = null

/**
 * Stands in for WidgetBoard, and derives its metrics the same way it does: subscribed to the
 * draft and the anchor, so the placements the hook sees are re-resolved on every move with the
 * dragged tile placed first. Passing a fixed set instead would hand the drop a layout from before
 * the gesture, which is the whole thing the grid drop exists to avoid.
 */
function Harness() {
  const ref = useRef<HTMLDivElement>(null)
  const draft = useOverviewStore((state) => state.draft)
  const anchorIndex = useOverviewStore((state) => state.anchorIndex)
  const placements = computePlacements(draft, grid.columnCount, anchorIndex)
  drag = useBoardDrag(ref, { ...grid, placements })
  return <div ref={ref} />
}

/** A press on a tile, carrying only the fields the hook reads off it. */
function press(instanceId: string, clientX: number, clientY: number) {
  const event = { button: 0, pointerType: "mouse", pointerId: 1, clientX, clientY, currentTarget: tile } as never
  act(() => {
    drag?.onTilePointerDown(event, instanceId)
  })
}

function pointer(type: string, clientX: number, clientY: number) {
  const event = new Event(type) as Event & { clientX: number; clientY: number; pointerId: number }
  event.clientX = clientX
  event.clientY = clientY
  event.pointerId = 1
  act(() => {
    window.dispatchEvent(event)
  })
}

/** Board-local coordinates, which is how every expectation below is easier to read. */
function move(localX: number, localY: number) {
  pointer("pointermove", BOARD_LEFT + localX, BOARD_TOP + localY)
}

function escape() {
  act(() => {
    // On the body, not the window: a real key event reaches the window through the capture phase,
    // and dispatching straight at it would run every window listener in registration order instead.
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  })
}

function cellOf(instanceId: string) {
  const widget = useOverviewStore.getState().draft.find((candidate) => candidate.instanceId === instanceId)
  return { column: widget?.column, row: widget?.row }
}

const boardOrder = () => useOverviewStore.getState().draft.map((widget) => widget.instanceId)

beforeEach(() => {
  // One rect for every div: the board and the pressed tile both sit at the board's origin here,
  // which makes a press at the board origin a grab on the tile's own corner.
  vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: BOARD_LEFT,
    top: BOARD_TOP,
    width: BOARD_WIDTH,
    height: 120,
  } as DOMRect)

  const store = useOverviewStore.getState()
  store.leaveOverview()
  store.configure({ manifest: lookup, save: vi.fn() })
  store.layoutLoaded(STORED)
  store.enterEdit()
  grid = { columnCount: 4, usedRows: 1 }

  container = document.createElement("div")
  document.body.appendChild(container)
  tile = document.createElement("div")
  root = createRoot(container)
  act(() => {
    root?.render(<Harness />)
  })
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = null
  container?.remove()
  container = null
  tile = null
  drag = null
  useOverviewStore.getState().leaveOverview()
  vi.restoreAllMocks()
})

describe("useBoardDrag", () => {
  it("compares the start threshold per axis, so a diagonal nudge is still a click", () => {
    press("a", BOARD_LEFT, BOARD_TOP)
    // 4 on both axes is inside the threshold on both, and the sum is irrelevant: a radius would
    // have started a drag here.
    move(4, 4)

    expect(useOverviewStore.getState().dragged).toBeNull()
  })

  it("starts once either axis passes the threshold on its own", () => {
    press("a", BOARD_LEFT, BOARD_TOP)
    move(5, 0)

    const state = useOverviewStore.getState()
    expect(state.dragged).toBe("a")
    expect(state.anchorIndex).toBe(0)
  })

  it("writes the cell the tile is nearest onto the dragged tile on every move", () => {
    press("a", BOARD_LEFT, BOARD_TOP)
    move(600, 60)

    expect(cellOf("a")).toEqual({ column: 2, row: 0 })
  })

  it("lets the tile follow the pointer, stopping at the right edge", () => {
    press("a", BOARD_LEFT, BOARD_TOP)
    move(600, 60)

    // A 2x1 tile is 512px wide, so its left edge cannot pass 528 without hanging off a 1040px
    // board. The pointer is welcome to go further; the tile is not.
    expect(useOverviewStore.getState().dragPosition).toEqual({ x: 528, y: 60 })
  })

  it("snaps to the nearest cell rather than the one the corner has entered", () => {
    press("a", BOARD_LEFT, BOARD_TOP)
    // 200px in is most of the way across the first column, and the tile visibly covers more of the
    // second. Flooring would still say column 0, which is what makes a board drag feel arbitrary.
    move(200, 10)

    expect(cellOf("a")).toEqual({ column: 1, row: 0 })
  })

  it("lets the pointer reach one row past the content, and no further", () => {
    press("a", BOARD_LEFT, BOARD_TOP)
    // Far below a board whose single row of content ends at y=120. The growth row is reachable; the
    // empty space under it is not, or a tile could be dropped into a row nothing can grow into.
    move(60, 700)

    expect(cellOf("a")).toEqual({ column: 0, row: 1 })
  })

  it("keeps the landed cell on release and ends the drag", () => {
    press("a", BOARD_LEFT, BOARD_TOP)
    move(600, 60)
    pointer("pointerup", BOARD_LEFT + 600, BOARD_TOP + 60)

    expect(cellOf("a")).toEqual({ column: 2, row: 0 })
    const state = useOverviewStore.getState()
    expect(state.dragged).toBeNull()
    expect(state.anchorIndex).toBe(-1)
    expect(state.dragPosition).toBeNull()
  })

  it("keeps the cell the ghost promised when a wider neighbour shares the row", () => {
    // "b" occupies columns 2 and 3. Dropping "a" onto column 2 has to displace it: while "a" is
    // held it is placed first and wins, and the ghost says so. Committing only "a"'s own cell
    // hands the row back to "b" the instant the anchor clears, and "a" slides down a row it was
    // never dropped on.
    press("a", BOARD_LEFT, BOARD_TOP)
    move(528, 10)
    pointer("pointerup", BOARD_LEFT + 528, BOARD_TOP + 10)

    expect(cellOf("a")).toEqual({ column: 2, row: 0 })
    // Straight down, never sideways: a tile that jumps left to fill a hole makes the board feel
    // like it is rearranging itself behind your back.
    expect(cellOf("b")).toEqual({ column: 2, row: 1 })
  })

  it("reorders instead of writing coordinates below the widest breakpoint", () => {
    grid = { columnCount: 2, usedRows: 2 }
    act(() => {
      root?.render(<Harness />)
    })
    press("b", BOARD_LEFT, BOARD_TOP)
    // Up and to the left of tile "a", which at two columns packs above it.
    move(10, 10)
    pointer("pointerup", BOARD_LEFT + 10, BOARD_TOP + 10)

    expect(boardOrder()).toEqual(["b", "a"])
    // "b" keeps the cell it was authored in at four columns, so widening the window brings that
    // arrangement back rather than the one this narrow drag expressed.
    expect(cellOf("b")).toEqual({ column: 2, row: 0 })
  })

  it("restores the origin cell on Escape without letting the page end the edit session", () => {
    const pageEscape = vi.fn()
    window.addEventListener("keydown", pageEscape)

    press("a", BOARD_LEFT, BOARD_TOP)
    move(600, 60)
    escape()

    expect(cellOf("a")).toEqual({ column: 0, row: 0 })
    expect(useOverviewStore.getState().dragged).toBeNull()
    // Still editing: Escape belonged to the drag, and a session that ended here would throw away
    // every other change the user made before picking the tile up.
    expect(useOverviewStore.getState().isEditMode).toBe(true)
    expect(pageEscape).not.toHaveBeenCalled()

    window.removeEventListener("keydown", pageEscape)
  })

  it("restores the origin cell when the gesture is taken away", () => {
    press("a", BOARD_LEFT, BOARD_TOP)
    move(600, 60)
    pointer("pointercancel", BOARD_LEFT + 600, BOARD_TOP + 60)

    expect(cellOf("a")).toEqual({ column: 0, row: 0 })
    expect(useOverviewStore.getState().dragged).toBeNull()
  })

  it("does nothing at all for a press that never crossed the threshold", () => {
    press("a", BOARD_LEFT, BOARD_TOP)
    move(3, 3)
    pointer("pointerup", BOARD_LEFT + 3, BOARD_TOP + 3)

    expect(cellOf("a")).toEqual({ column: 0, row: 0 })
    expect(useOverviewStore.getState().dragPosition).toBeNull()
  })

  it("stops listening once the gesture is over", () => {
    press("a", BOARD_LEFT, BOARD_TOP)
    move(600, 60)
    pointer("pointerup", BOARD_LEFT + 600, BOARD_TOP + 60)
    // A stale listener would treat this as a drag still in flight and move the tile again.
    move(60, 60)

    expect(cellOf("a")).toEqual({ column: 2, row: 0 })
  })
})
