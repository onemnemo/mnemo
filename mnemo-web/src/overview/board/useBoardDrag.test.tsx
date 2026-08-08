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

import { useOverviewStore } from "../store"
import type { ManifestLookup, WidgetManifest } from "../widgets/manifest"
import { useBoardDrag, type BoardDrag, type BoardDragMetrics } from "./useBoardDrag"

// A four-column board at the widest breakpoint: 1040px of content is 248px per column once the
// three 16px gaps come out, so column c starts at c * 264 and row r at r * 136.
const BOARD_LEFT = 100
const BOARD_TOP = 50
const BOARD_WIDTH = 1040
const METRICS: BoardDragMetrics = { columnCount: 4, usedRows: 1 }

function manifestOf(widgetId: string): WidgetManifest {
  const supportedSizes = [{ columns: 2, rows: 1 }]
  return {
    widgetId,
    ns: "Overview",
    author: "Mnemo",
    category: "statistics",
    icon: `widgets/${widgetId}`,
    supportedSizes,
    defaultSize: supportedSizes[0],
  }
}

const lookup: ManifestLookup = (widgetId) =>
  widgetId === "mnemo.flashcard-stats" || widgetId === "mnemo.recent-decks" ? manifestOf(widgetId) : undefined

/** Two 2x1 tiles side by side on the top row. */
const STORED: OverviewLayoutDto = {
  schemaVersion: 3,
  profileId: "default",
  widgets: [
    {
      instanceId: "a",
      widgetId: "mnemo.flashcard-stats",
      size: { columns: 2, rows: 1 },
      column: 0,
      row: 0,
      order: 0,
      settings: {},
    },
    {
      instanceId: "b",
      widgetId: "mnemo.recent-decks",
      size: { columns: 2, rows: 1 },
      column: 2,
      row: 0,
      order: 1,
      settings: {},
    },
  ],
}

let drag: BoardDrag | null = null
let root: Root | null = null
let container: HTMLDivElement | null = null

function Harness() {
  const ref = useRef<HTMLDivElement>(null)
  drag = useBoardDrag(ref, METRICS)
  return <div ref={ref} />
}

/** A press on the drag handle, carrying only the fields the hook reads off it. */
function press(instanceId: string, clientX: number, clientY: number) {
  const event = { button: 0, pointerType: "mouse", pointerId: 1, clientX, clientY } as never
  act(() => {
    drag?.onHandlePointerDown(event, instanceId, "Flashcard stats")
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

beforeEach(() => {
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

  container = document.createElement("div")
  document.body.appendChild(container)
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
    expect(state.ghost).toMatchObject({ visible: true, title: "Flashcard stats", sizeLabel: "2×1" })
  })

  it("writes the cell under the pointer onto the dragged tile on every move", () => {
    press("a", BOARD_LEFT, BOARD_TOP)
    move(600, 60)

    expect(cellOf("a")).toEqual({ column: 2, row: 0 })
  })

  it("trails the ghost below-right of the pointer in board coordinates", () => {
    press("a", BOARD_LEFT, BOARD_TOP)
    move(600, 60)

    expect(useOverviewStore.getState().ghost).toMatchObject({ x: 614, y: 74 })
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
    expect(state.ghost.visible).toBe(false)
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
    expect(useOverviewStore.getState().ghost.visible).toBe(false)
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
