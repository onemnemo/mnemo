/**
 * How a chord is spelled on screen, and what a key press turns into.
 *
 * The display map matters more than it looks: the canonical form is Avalonia's key
 * enum, so an unmapped token leaks straight through to a page whose entire job is to
 * tell someone which key to press. `D0` and `NumPad0` are the two the shipped catalog
 * actually uses.
 *
 * `isMac` is decided once, when the module is imported, so a suite that imports it plainly
 * pins whichever machine happens to run it. The platform is declared here instead, and both
 * spellings are covered: the mac one is a different set of glyphs and a different modifier
 * key, and asserting only the other platform's is how it stayed unchecked.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

// Hoisted above the import below, which is the only window in which `navigator` can be set
// for a module that reads it as it loads.
vi.hoisted(() => {
  vi.stubGlobal("navigator", { platform: "Win32", userAgent: "" })
})

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

describe("on macOS", () => {
  // Its own copy of the module: one process can only see one platform per instance, and the
  // static import above is already the Windows one.
  let mac: typeof import("./chord")

  beforeAll(async () => {
    vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "" })
    vi.resetModules()
    mac = await import("./chord")
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it("engraves the modifiers as the symbols printed on the keyboard", () => {
    expect(mac.formatChordParts("Primary+Shift+H")).toEqual(["⌘", "⇧", "H"])
  })

  it("runs the caps together, the way the platform writes a shortcut", () => {
    expect(mac.formatChord("Primary+K")).toBe("⌘K")
  })

  it("prints Primary and Ctrl as the two different keys they are here", () => {
    expect(mac.formatChordParts("Ctrl+Primary+K")).toEqual(["⌘", "⌃", "K"])
  })

  it("records Cmd as Primary, and Control as itself", () => {
    expect(mac.chordFromEvent(press("KeyH", { metaKey: true, shiftKey: true }))).toBe("Primary+Shift+H")
    expect(mac.chordFromEvent(press("KeyH", { ctrlKey: true }))).toBe("Ctrl+H")
  })

  it("matches Cmd against Primary, and refuses the Ctrl that stands in for it elsewhere", () => {
    const chord = mac.parseChord("Primary+Z")
    expect(mac.matchesEvent(chord, press("KeyZ", { metaKey: true }))).toBe(true)
    expect(mac.matchesEvent(chord, press("KeyZ", { ctrlKey: true }))).toBe(false)
  })
})
