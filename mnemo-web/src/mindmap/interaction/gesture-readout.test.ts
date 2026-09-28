// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest"

import { holdGrip, openChip, placeAngleChip, placeSizeChip, releaseGrip, wholeDegrees } from "./gesture-readout"

function pane(): HTMLElement {
  const element = document.createElement("div")
  element.getBoundingClientRect = () => new DOMRect(100, 50, 800, 600)
  document.body.append(element)
  return element
}

afterEach(() => {
  document.body.replaceChildren()
})

describe("the size chip", () => {
  it("sits centred 12px under the element, in pane pixels", () => {
    const at = pane()
    const host = document.createElement("div")
    host.getBoundingClientRect = () => new DOMRect(300, 200, 120, 40)
    const chip = openChip(at)

    placeSizeChip(chip, at, host, 120.4, 39.6)

    expect(chip.textContent).toBe("120 × 40")
    expect(chip.style.transform).toBe("translate(260px, 202px) translate(-50%, 0)")
  })

  it("measures a rotated shape by its turned bounds rather than the upright host", () => {
    const at = pane()
    const host = document.createElement("div")
    host.getBoundingClientRect = () => new DOMRect(300, 200, 120, 40)
    const rotor = document.createElement("div")
    rotor.dataset.mmRotor = ""
    rotor.getBoundingClientRect = () => new DOMRect(290, 180, 140, 80)
    host.append(rotor)
    const chip = openChip(at)

    placeSizeChip(chip, at, host, 120, 40)

    expect(chip.style.transform).toBe("translate(260px, 222px) translate(-50%, 0)")
  })
})

describe("the angle chip", () => {
  it("sits 22px right of and 34px above the pointer", () => {
    const at = pane()
    const chip = openChip(at)

    placeAngleChip(chip, at, 400, 300, 44.6)

    expect(chip.textContent).toBe("45°")
    expect(chip.style.transform).toBe("translate(322px, 216px) translate(-50%, 0)")
  })

  it("never reads 360, which is past the slider's maximum", () => {
    expect(wholeDegrees(359.6)).toBe(0)
    expect(wholeDegrees(359.4)).toBe(359)
  })
})

describe("a held grip", () => {
  it("is the handle the press landed in, marked until it is let go", () => {
    const grip = document.createElement("span")
    grip.dataset.mmHandle = "se"
    const inner = document.createElement("i")
    grip.append(inner)

    const held = holdGrip(inner)
    expect(held).toBe(grip)
    expect(grip.hasAttribute("data-mm-active")).toBe(true)

    releaseGrip(held)
    expect(grip.hasAttribute("data-mm-active")).toBe(false)
  })
})
