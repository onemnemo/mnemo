/**
 * How a chord is spelled on screen, and what a key press turns into.
 *
 * The display map matters more than it looks: the canonical form is Avalonia's key
 * enum, so an unmapped token leaks straight through to a page whose entire job is to
 * tell someone which key to press. `D0` and `NumPad0` are the two the shipped catalog
 * actually uses.
 */

import { describe, expect, it } from "vitest"

import { chordFromEvent, formatChord, formatChordParts, parseChord } from "./chord"

/** A KeyboardEvent stand-in; only `code`, `key` and the modifier flags are read. */
function press(code: string, modifiers: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { code, key: "", ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...modifiers } as KeyboardEvent
}

describe("formatChordParts", () => {
  it("gives each key its own cap, modifiers first", () => {
    expect(formatChordParts("Primary+Shift+H")).toEqual(["Ctrl", "Shift", "H"])
  })

  it("spells a digit as the digit, not as its enum name", () => {
    expect(formatChordParts("Primary+D0")).toEqual(["Ctrl", "0"])
  })

  it("names the numeric keypad, so it is distinguishable from the row of digits", () => {
    expect(formatChordParts("Primary+NumPad0")).toEqual(["Ctrl", "Num 0"])
  })

  it("renders the Oem punctuation names as the punctuation", () => {
    expect(formatChordParts("Primary+OemComma")).toEqual(["Ctrl", ","])
  })

  it("shortens the named keys a keyboard prints on the cap", () => {
    expect(formatChordParts("Escape")).toEqual(["Esc"])
    expect(formatChordParts("Delete")).toEqual(["Del"])
    expect(formatChordParts("Back")).toEqual(["⌫"])
  })

  it("leaves a token it has no spelling for alone rather than blanking it", () => {
    expect(formatChordParts("F5")).toEqual(["F5"])
  })

  it("drops the redundant Ctrl when Primary is already Ctrl on this platform", () => {
    // Primary and Ctrl are the same physical key off macOS, so printing both would
    // ask for a modifier to be held twice.
    expect(formatChordParts("Ctrl+Primary+K")).toEqual(["Ctrl", "K"])
  })
})

describe("formatChord", () => {
  it("joins the caps into the one-line pill the topbar uses", () => {
    expect(formatChord("Primary+K")).toBe("Ctrl K")
  })
})

describe("chordFromEvent", () => {
  it("records a numpad digit, which the catalog binds and a recorder must reproduce", () => {
    expect(chordFromEvent(press("Numpad0", { ctrlKey: true }))).toBe("Primary+NumPad0")
  })

  it("records the digit row as a D token", () => {
    expect(chordFromEvent(press("Digit0", { ctrlKey: true }))).toBe("Primary+D0")
  })

  it("keeps listening while only modifiers are held", () => {
    expect(chordFromEvent(press("ShiftLeft", { shiftKey: true }))).toBeNull()
  })

  it("round-trips through the parser", () => {
    const chord = chordFromEvent(press("KeyH", { ctrlKey: true, shiftKey: true }))
    expect(chord).toBe("Primary+Shift+H")
    expect(parseChord(chord!)).toMatchObject({ primary: true, shift: true, alt: false, key: "H" })
  })
})
