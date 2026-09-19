// @vitest-environment jsdom

/**
 * A node label open in the notes editor: what the keys mean, what a paste becomes, what the chrome
 * anchored to the caret does when the map moves under it, and that closing it leaves nothing on the
 * page. Typed one character at a time through the same hooks a real keystroke reaches, so the
 * symbol palette and the script shortcuts see what a user's would.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { Slice } from "prosemirror-model"
import type { EditorView } from "prosemirror-view"

import { MNEMO_CLIPBOARD_MIME } from "@/notes/clipboard/write-clipboard"
import { editorSchema } from "@/notes/editor/schema"
import { defaultTextStyle, type InlineSpan } from "@/notes/model/types"

import { createCameraSignal } from "../canvas/camera-signal"
import { flattenRuns } from "../model/runs"
import { openLabelEditor, type LabelEditor, type LabelEditorOptions } from "./label-editor"

const text = (value: string, style: Partial<InlineSpan["style"]> = {}): InlineSpan => ({
  kind: "text",
  text: value,
  style: { ...defaultTextStyle, ...style },
})

beforeAll(() => {
  // jsdom lays nothing out and ships neither of these; ProseMirror's mouse path asks the document
  // what is under the pointer, and the palette scrolls its current row into view.
  ;(document as Document & { elementFromPoint: () => Element | null }).elementFromPoint = () => null
  Element.prototype.scrollIntoView = function scrollIntoView(): void {
    // no layout to scroll
  }
})

const open: LabelEditor[] = []
let host: HTMLElement | null = null

afterEach(() => {
  while (open.length > 0) open.pop()!.destroy()
  host?.remove()
  host = null
  localStorage.clear()
})

function mount(runs: InlineSpan[], over: Partial<LabelEditorOptions> = {}) {
  host = document.createElement("div")
  document.body.appendChild(host)
  const onChange = vi.fn<(runs: InlineSpan[]) => void>()
  const onFinish = vi.fn<(runs: InlineSpan[] | null) => void>()
  const editor = openLabelEditor({ mount: host, runs, onChange, onFinish, ...over })
  open.push(editor)
  return { editor, view: editor.view, onChange, onFinish }
}

/** Types `value` one character at a time, the way the triggers really see it. */
function type(view: EditorView, value: string): void {
  for (const character of value) {
    const { from, to } = view.state.selection
    const handled = view.someProp("handleTextInput", (handler) =>
      handler(view, from, to, character, () => view.state.tr),
    )
    if (!handled) view.dispatch(view.state.tr.insertText(character, from, to))
  }
}

function press(view: EditorView, key: string, init: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })
  return view.someProp("handleKeyDown", (handler) => handler(view, event)) === true
}

function paste(view: EditorView, entries: Record<string, string>): boolean {
  const data = {
    getData: (mime: string) => entries[mime] ?? "",
    setData: () => {},
  } as unknown as DataTransfer
  const event = { clipboardData: data, preventDefault: () => {} } as unknown as ClipboardEvent
  return view.someProp("handlePaste", (handler) => handler(view, event, Slice.empty)) === true
}

function toolbar(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".notes-formatting-toolbar")
}

function blurTo(view: EditorView, relatedTarget: Element | null): void {
  view.dom.dispatchEvent(new FocusEvent("blur", { relatedTarget }))
}

describe("opening and closing", () => {
  it("mounts the editor over the runs, and destroy takes it and its chrome off the page", () => {
    const { editor, view } = mount([text("hel"), text("lo", { bold: true })])

    expect(host!.querySelector(".ProseMirror")).toBe(view.dom)
    expect(view.state.doc.childCount).toBe(1)
    expect(view.state.doc.firstChild?.type.name).toBe("paragraph")
    expect(editor.runs()).toEqual([text("hel"), text("lo", { bold: true })])
    expect(toolbar()).not.toBeNull()

    editor.destroy()
    editor.destroy()

    expect(host!.querySelector(".ProseMirror")).toBeNull()
    expect(toolbar()).toBeNull()
    host!.remove()
    expect(document.body.children).toHaveLength(0)
  })

  it("opens with the whole label selected, the way a field does", () => {
    const { view } = mount([text("hello")])
    expect(view.state.selection.from).toBe(2)
    expect(view.state.selection.to).toBe(2 + "hello".length)
  })

  it("can open with the caret after the label instead", () => {
    const { view } = mount([text("hello")], { caret: "end" })
    expect(view.state.selection.empty).toBe(true)
    expect(view.state.selection.from).toBe(2 + "hello".length)
  })

  it("reports every change as runs", () => {
    const { view, onChange } = mount([text("hello")], { caret: "end" })
    type(view, "!")
    expect(onChange).toHaveBeenLastCalledWith([text("hello!")])
  })
})

describe("the keys", () => {
  it("Enter finishes with the runs", () => {
    const { view, onFinish } = mount([text("hello")], { caret: "end" })
    type(view, " there")
    expect(press(view, "Enter")).toBe(true)
    expect(onFinish).toHaveBeenCalledWith([text("hello there")])
    expect(view.state.doc.childCount).toBe(1)
  })

  it("Mod-Enter finishes too, rather than toggling a checklist or leaving a code block", () => {
    const { view, onFinish } = mount([text("hello")])
    expect(press(view, "Enter", { ctrlKey: true })).toBe(true)
    expect(onFinish).toHaveBeenCalledWith([text("hello")])
  })

  it("Shift-Enter breaks the line inside the one run", () => {
    const { view, onChange, onFinish } = mount([text("hello")], { caret: "end" })
    expect(press(view, "Enter", { shiftKey: true })).toBe(true)
    expect(onChange).toHaveBeenLastCalledWith([text("hello\n")])
    expect(onFinish).not.toHaveBeenCalled()
    expect(view.state.doc.childCount).toBe(1)
  })

  it("Escape abandons", () => {
    const { view, onFinish } = mount([text("hello")])
    expect(press(view, "Escape")).toBe(true)
    expect(onFinish).toHaveBeenCalledWith(null)
  })

  it("Escape first ends an armed superscript, and only the next press abandons", () => {
    const { view, onFinish } = mount([text("x")], { caret: "end" })
    expect(press(view, ".", { ctrlKey: true })).toBe(true)
    expect(view.state.storedMarks?.some((mark) => mark.type.name === "sup")).toBe(true)

    expect(press(view, "Escape")).toBe(true)
    expect(onFinish).not.toHaveBeenCalled()
    expect(view.state.storedMarks?.some((mark) => mark.type.name === "sup") ?? false).toBe(false)

    expect(press(view, "Escape")).toBe(true)
    expect(onFinish).toHaveBeenCalledWith(null)
  })

  it("Mod-b bolds the selection, and the finish carries it", () => {
    const { view, onFinish } = mount([text("hello")])
    expect(press(view, "b", { ctrlKey: true })).toBe(true)
    press(view, "Enter")
    expect(onFinish).toHaveBeenCalledWith([text("hello", { bold: true })])
  })

  it("Tab goes nowhere", () => {
    const { view, onFinish } = mount([text("hello")])
    expect(press(view, "Tab")).toBe(true)
    expect(press(view, "Tab", { shiftKey: true })).toBe(true)
    expect(onFinish).not.toHaveBeenCalled()
    expect(view.state.doc.textContent).toBe("hello")
  })

  it("Enter with the symbol palette open picks the symbol and does not finish", () => {
    const { view, onFinish } = mount([text("angle ")], { caret: "end" })
    type(view, "\\alpha")
    expect(document.querySelector(".notes-slash-menu:not([data-hidden])")).not.toBeNull()

    expect(press(view, "Enter")).toBe(true)

    expect(onFinish).not.toHaveBeenCalled()
    expect(view.state.doc.textContent).toBe("angle α")
  })

  it("a list marker stays the words it is, since a label has no blocks to become", () => {
    const { view, onFinish } = mount([text("")])
    type(view, "1. First")
    press(view, "Enter")
    expect(onFinish).toHaveBeenCalledWith([text("1. First")])
  })
})

describe("a paste", () => {
  it("folds a run of note blocks into the one line, marks kept and blocks joined by a break", () => {
    const { view, editor } = mount([text("hello")], { caret: "end" })
    const { schema } = editorSchema()
    const bold = schema.marks.strong.create()
    const run = Slice.fromJSON(
      schema,
      new Slice(
        schema.nodes.doc.create(null, [
          schema.nodes.paragraph.create(null, schema.nodes.line.create(null, schema.text("one", [bold]))),
          schema.nodes.heading.create(null, schema.nodes.line.create(null, schema.text("two"))),
        ]).content,
        0,
        0,
      ).toJSON(),
    )

    expect(
      paste(view, {
        [MNEMO_CLIPBOARD_MIME]: JSON.stringify({ v: 1, nonce: "gone", mode: "blocks", slice: run.toJSON() }),
      }),
    ).toBe(true)

    expect(view.state.doc.childCount).toBe(1)
    expect(view.state.doc.firstChild?.type.name).toBe("paragraph")
    expect(editor.runs()).toEqual([text("hello\n"), text("one", { bold: true }), text("\ntwo")])
    expect(view.state.selection.from).toBe(view.state.doc.content.size - 2)
  })

  it("folds a two-line plain paste the same way", () => {
    const { view, editor } = mount([text("hello")], { caret: "end" })
    expect(paste(view, { "text/plain": "a\nb" })).toBe(true)
    expect(view.state.doc.childCount).toBe(1)
    expect(flattenRuns(editor.runs())).toBe("hello\na\nb")
  })

  it("a one-line paste still lands at the caret as text", () => {
    const { view, editor } = mount([text("hello ")], { caret: "end" })
    expect(paste(view, { "text/plain": "world" })).toBe(true)
    expect(flattenRuns(editor.runs())).toBe("hello world")
    expect(view.state.doc.childCount).toBe(1)
  })
})

describe("the focus leaving", () => {
  it("finishes with the runs when it goes anywhere else", () => {
    const { view, onFinish } = mount([text("hello")])
    blurTo(view, null)
    expect(onFinish).toHaveBeenCalledWith([text("hello")])
  })

  it("holds while it is in the equation card, the link flyout or the toolbar", () => {
    const { view, onFinish } = mount([text("hello")])
    for (const surface of ["notes-equation-flyout", "notes-link-flyout", "notes-formatting-toolbar"]) {
      const chrome = document.createElement("div")
      chrome.className = surface
      const field = document.createElement("input")
      chrome.appendChild(field)
      document.body.appendChild(chrome)
      blurTo(view, field)
      chrome.remove()
    }
    expect(onFinish).not.toHaveBeenCalled()
  })
})

describe("the toolbar under the camera", () => {
  it("moves with a camera tick, since the caret's place on screen moved", () => {
    const camera = createCameraSignal()
    const { view } = mount([text("hello")], { camera })
    const bubble = toolbar()!
    expect(bubble.hasAttribute("data-hidden")).toBe(false)

    let rect = { top: 100, bottom: 120, left: 200, right: 240 }
    view.coordsAtPos = () => rect
    camera.emit()
    const first = { top: bubble.style.top, left: bubble.style.left }
    expect(first.top).not.toBe("")

    rect = { top: 300, bottom: 320, left: 500, right: 540 }
    camera.emit()
    expect(bubble.style.top).not.toBe(first.top)
    expect(bubble.style.left).not.toBe(first.left)
  })

  it("stops listening once destroyed", () => {
    const camera = createCameraSignal()
    const { editor, view } = mount([text("hello")], { camera })
    const seen = vi.fn()
    view.dom.addEventListener("scroll", seen)
    camera.emit()
    expect(seen).toHaveBeenCalledTimes(1)
    editor.destroy()
    camera.emit()
    expect(seen).toHaveBeenCalledTimes(1)
  })
})
