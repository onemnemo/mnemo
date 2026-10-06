// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { OcclusionDocument } from "../../facts/occlusion"
import { keyEvent, trio } from "./test-kit"
import { useOcclusionEditor, type OcclusionEditor } from "./useOcclusionEditor"
import type { EditorEnv } from "./store"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let editor: OcclusionEditor

beforeEach(() => {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function Probe({ initial, env }: { initial: OcclusionDocument; env: EditorEnv }) {
  editor = useOcclusionEditor(initial, env)
  return null
}

function mount(env: EditorEnv = {}) {
  act(() => root.render(<Probe initial={trio()} env={env} />))
}

describe("useOcclusionEditor", () => {
  it("exposes the document, cards and selection", () => {
    mount()
    expect(editor.cards.map((c) => c.number)).toEqual([1, 2, 3])
    act(() => editor.perform("select-all"))
    expect(editor.selection).toEqual(["a", "b", "c"])
    expect(editor.selectionIsGroup).toBe(false)
  })

  it("reports each committed document to the owner", () => {
    const onChange = vi.fn()
    mount({ onChange })
    act(() => editor.perform("next-mask"))
    act(() => editor.perform("delete"))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].masks.map((m: { id: string }) => m.id)).toEqual(["b", "c"])
    expect(editor.canUndo).toBe(true)
    expect(editor.canRedo).toBe(false)
  })

  it("uses the latest callbacks, not the first render's", () => {
    const first = vi.fn()
    const second = vi.fn()
    mount({ onRename: first })
    act(() => root.render(<Probe initial={trio()} env={{ onRename: second }} />))
    act(() => editor.perform("next-mask"))
    act(() => editor.perform("rename"))
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith("a")
  })

  it("maps keys to actions", () => {
    mount()
    const event = keyEvent("a", { ctrlKey: true })
    act(() => {
      editor.onKeyDown(event)
    })
    expect(event.defaultPrevented).toBe(true)
    expect(editor.selection).toHaveLength(3)

    const unused = keyEvent("Enter")
    act(() => {
      editor.onKeyDown(unused)
    })
    expect(unused.defaultPrevented).toBe(false)
  })

  it("reads Ungroup when the selection is one group", () => {
    mount()
    act(() => editor.perform("select-all"))
    act(() => editor.perform("group"))
    expect(editor.selectionIsGroup).toBe(true)
  })
})
