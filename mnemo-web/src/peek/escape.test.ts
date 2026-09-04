// @vitest-environment jsdom

/**
 * Escape is contested. Almost every press of it while the peek is open belongs to
 * somebody else, and two cases decide the rule. The note editor leaves one press
 * unhandled, a caret in prose with nothing selected and no find bar open, so without a
 * guard the panel would take a key aimed at the document. And a field inside the panel
 * is still a field: the assistant's composer holds its draft in component state and
 * answers only Enter, so closing on that press would unmount what was typed.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { escapeContextOf, escapeShouldClosePeek, isEditableElement } from "./escape"

const OPEN = {
  defaultPrevented: false,
  overlayOpen: false,
  focusIsEditable: false,
  closable: true,
} as const

let panel: HTMLElement
let editor: HTMLElement

beforeEach(() => {
  panel = document.createElement("aside")
  panel.tabIndex = -1
  document.body.append(panel)

  editor = document.createElement("div")
  editor.setAttribute("contenteditable", "true")
  editor.tabIndex = 0
  document.body.append(editor)
})

afterEach(() => {
  document.body.innerHTML = ""
})

describe("escape rules", () => {
  it("closes an unpinned overlay when nothing editable holds focus", () => {
    expect(escapeShouldClosePeek(OPEN)).toBe(true)
  })

  it("leaves the key alone once somebody ahead of it answered", () => {
    expect(escapeShouldClosePeek({ ...OPEN, defaultPrevented: true })).toBe(false)
  })

  it("leaves the key to an open menu or dialog", () => {
    expect(escapeShouldClosePeek({ ...OPEN, overlayOpen: true })).toBe(false)
  })

  it("does nothing for a pinned or docked peek", () => {
    expect(escapeShouldClosePeek({ ...OPEN, closable: false })).toBe(false)
  })

  it("does not steal the key from a caret in the main editor", () => {
    expect(escapeShouldClosePeek({ ...OPEN, focusIsEditable: true })).toBe(false)
  })

  // The panel's own field counts too. The assistant's composer is the one that exists,
  // and closing the panel there discards the draft rather than dismissing anything.
  it("does not close on a field inside the panel", () => {
    expect(escapeShouldClosePeek({ ...OPEN, focusIsEditable: true })).toBe(false)
  })
})

describe("what counts as editable", () => {
  it("counts a text field and a live editor", () => {
    const input = document.createElement("input")
    input.type = "text"
    expect(isEditableElement(input)).toBe(true)
    expect(isEditableElement(document.createElement("textarea"))).toBe(true)
    expect(isEditableElement(editor)).toBe(true)
  })

  it("does not count a checkbox, a button, or a read-only editor mount", () => {
    const checkbox = document.createElement("input")
    checkbox.type = "checkbox"
    expect(isEditableElement(checkbox)).toBe(false)
    expect(isEditableElement(document.createElement("button"))).toBe(false)

    // What `editable: false` produces, which is exactly what the peek mounts.
    const readOnly = document.createElement("div")
    readOnly.setAttribute("contenteditable", "false")
    expect(isEditableElement(readOnly)).toBe(false)
  })

  it("reads the host rather than the node the press landed on", () => {
    const span = document.createElement("span")
    editor.append(span)
    expect(isEditableElement(span)).toBe(true)
  })
})

describe("reading the context off a real event", () => {
  it("sees the caret in the main editor", () => {
    editor.focus()
    const context = escapeContextOf(new KeyboardEvent("keydown", { key: "Escape" }), true)

    expect(context.focusIsEditable).toBe(true)
    expect(escapeShouldClosePeek(context)).toBe(false)
  })

  it("sees a field inside the panel", () => {
    const composer = document.createElement("textarea")
    panel.append(composer)
    composer.focus()

    const context = escapeContextOf(new KeyboardEvent("keydown", { key: "Escape" }), true)
    expect(context.focusIsEditable).toBe(true)
    expect(escapeShouldClosePeek(context)).toBe(false)
  })

  it("closes with focus on the panel itself, which is not a field", () => {
    panel.focus()
    const context = escapeContextOf(new KeyboardEvent("keydown", { key: "Escape" }), true)

    expect(context.focusIsEditable).toBe(false)
    expect(escapeShouldClosePeek(context)).toBe(true)
  })

  it("sees an open menu anywhere in the document", () => {
    const menu = document.createElement("div")
    menu.setAttribute("role", "menu")
    document.body.append(menu)

    const context = escapeContextOf(new KeyboardEvent("keydown", { key: "Escape" }), true)
    expect(context.overlayOpen).toBe(true)
  })
})
