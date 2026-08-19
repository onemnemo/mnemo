// @vitest-environment jsdom

/**
 * The overflow menu's Delete entry.
 *
 * A branch delete removes the selection and everything under it, and a label that only ever said
 * "Delete" understated that the moment a selected node had children: pressing it looked like it
 * would remove one node and actually removed a whole subtree. Pinned here against the real menu
 * item rather than against `deleteCount` alone, since what shipped wrong was the label, not the
 * count it was fed.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { NodeBar, type NodeActions, type NodeBarProps } from "./NodeBar"
import type { SceneElement } from "../model/scene"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function element(): SceneElement {
  return {
    id: "a",
    kind: "node",
    content: { $type: "text", text: "a" },
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    depth: 1,
    branch: 0,
    nodeShape: "card",
    text: { lines: ["a"], fontSize: 14, fontWeight: 500, lineHeight: 19, letterSpacing: "-0.005em" },
    padding: { x: 11, y: 7 },
    isRoot: false,
    childCount: 0,
    hiddenCount: 0,
  }
}

function actions(over: Partial<NodeActions> = {}): NodeActions {
  return {
    onPin: vi.fn(),
    collapse: null,
    onSaveTemplate: null,
    onOutdent: null,
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    deleteCount: 1,
    ...over,
  }
}

function props(over: Partial<NodeBarProps> = {}): NodeBarProps {
  return {
    element: element(),
    count: 1,
    onStyle: vi.fn(),
    color: null,
    onKind: null,
    actions: actions(),
    ...over,
  }
}

let container: HTMLElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function openOverflow(): void {
  const more = container.querySelector<HTMLButtonElement>('button[aria-label="More"]')!
  act(() => more.click())
}

/** The overflow's Delete entry, by the icon only Delete wears among the menu's buttons. */
function deleteButton(): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes("Delete"),
  )
  expect(button, "the overflow menu's Delete entry").not.toBeUndefined()
  return button!
}

describe("the overflow menu's Delete entry", () => {
  it("says plain Delete when the selection has nothing under it", () => {
    act(() => root.render(<NodeBar {...props({ actions: actions({ deleteCount: 1 }) })} />))
    openOverflow()

    expect(deleteButton().textContent).toBe("Delete")
  })

  it("counts what a delete actually reaches once it is more than the selection itself", () => {
    act(() => root.render(<NodeBar {...props({ actions: actions({ deleteCount: 4 }) })} />))
    openOverflow()

    expect(deleteButton().textContent).toBe("Delete (4)")
  })

  it("runs the action and closes the menu on a press", () => {
    const onDelete = vi.fn()
    act(() => root.render(<NodeBar {...props({ actions: actions({ deleteCount: 1, onDelete }) })} />))
    openOverflow()

    act(() => deleteButton().click())

    expect(onDelete).toHaveBeenCalledTimes(1)
    // The menu closed along with the press, so its Delete entry is gone rather than merely re-labelled.
    expect([...container.querySelectorAll("button")].some((b) => b.textContent?.includes("Delete"))).toBe(
      false,
    )
  })
})
