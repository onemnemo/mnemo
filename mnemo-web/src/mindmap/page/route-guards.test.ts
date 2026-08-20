// @vitest-environment jsdom

/**
 * What a Tab or Enter on the map's own chrome must not do.
 *
 * Before these guards, the route treated every keydown on the canvas div as the map's: Tab always
 * added a child and Enter always added a sibling, even when focus was sitting on a toolbar button or
 * a flyout menu item. A keyboard user who tabbed onto that chrome lost the browser's own Tab/Enter the
 * moment they landed on it. Pinned here against a bare DOM tree, with none of the canvas or stores the
 * route itself needs.
 */
import { describe, expect, it } from "vitest"

import { isChromeControl, isTyping } from "./route-guards"

describe("isTyping", () => {
  it("is true for the field elements a key could be typed into", () => {
    expect(isTyping(document.createElement("input"))).toBe(true)
    expect(isTyping(document.createElement("textarea"))).toBe(true)
    expect(isTyping(document.createElement("select"))).toBe(true)

    const editable = document.createElement("div")
    editable.setAttribute("contenteditable", "true")
    expect(isTyping(editable)).toBe(true)
  })

  it("is false for the canvas pane and for null", () => {
    expect(isTyping(document.createElement("div"))).toBe(false)
    expect(isTyping(document.createElement("button"))).toBe(false)
    expect(isTyping(null)).toBe(false)
  })
})

describe("isChromeControl", () => {
  it("is true for a button, a link, and the menu roles the flyouts use", () => {
    expect(isChromeControl(document.createElement("button"))).toBe(true)

    const link = document.createElement("a")
    link.href = "#"
    expect(isChromeControl(link)).toBe(true)

    for (const role of ["menuitem", "option", "tab"]) {
      const el = document.createElement("div")
      el.setAttribute("role", role)
      expect(isChromeControl(el)).toBe(true)
    }
  })

  it("is true for something nested inside a button, since that is what an icon press actually targets", () => {
    const button = document.createElement("button")
    const icon = document.createElement("span")
    button.append(icon)
    expect(isChromeControl(icon)).toBe(true)
  })

  it("is false for a bare link with no href, and for the canvas pane itself", () => {
    const link = document.createElement("a")
    expect(isChromeControl(link)).toBe(false)
    expect(isChromeControl(document.createElement("div"))).toBe(false)
    expect(isChromeControl(null)).toBe(false)
  })
})
