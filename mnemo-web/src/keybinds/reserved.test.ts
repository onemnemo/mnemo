/**
 * The chords the Keyboard page must never store: the ones the window guard swallows
 * before the keymap sees them. The rule here has to agree with the guard's own tests in
 * lib/native-keys.test.ts, press for press.
 */

import { describe, expect, it } from "vitest"

import { isReservedChord, isReservedPress } from "./reserved"

describe("isReservedChord", () => {
  it("refuses every spelling of reload", () => {
    for (const apple of [false, true]) {
      expect(isReservedChord("F5", apple)).toBe(true)
      expect(isReservedChord("Shift+F5", apple)).toBe(true)
      expect(isReservedChord("Primary+F5", apple)).toBe(true)
      expect(isReservedChord("Alt+F5", apple)).toBe(true)
      expect(isReservedChord("Primary+R", apple)).toBe(true)
      expect(isReservedChord("Primary+Shift+R", apple)).toBe(true)
      expect(isReservedChord("Ctrl+R", apple)).toBe(true)
    }
  })

  it("refuses the print chord with the modifier the platform prints on", () => {
    expect(isReservedChord("Primary+P", false)).toBe(true)
    expect(isReservedChord("Ctrl+P", false)).toBe(true)
    expect(isReservedChord("Primary+P", true)).toBe(true)
  })

  // Ctrl+P moves the caret on macOS; printing is Cmd+P.
  it("leaves the caret chord alone on apple platforms", () => {
    expect(isReservedChord("Ctrl+P", true)).toBe(false)
  })

  it("leaves the app's own chords alone", () => {
    for (const apple of [false, true]) {
      expect(isReservedChord("R", apple)).toBe(false)
      expect(isReservedChord("P", apple)).toBe(false)
      expect(isReservedChord("Primary+S", apple)).toBe(false)
      expect(isReservedChord("Primary+F", apple)).toBe(false)
      expect(isReservedChord("Primary+K", apple)).toBe(false)
      expect(isReservedChord("Alt+Primary+R", apple)).toBe(false)
      expect(isReservedChord("Primary+Shift+P", apple)).toBe(false)
      expect(isReservedChord("F6", apple)).toBe(false)
    }
  })
})

describe("isReservedPress", () => {
  // Off macOS the guard claims Meta+R too (the Windows key), the way it always has.
  it("claims reload under the meta key off apple platforms", () => {
    expect(isReservedPress({ key: "R", ctrl: false, meta: true, alt: false, shift: false }, false)).toBe(true)
  })

  it("claims nothing without a modifier but F5", () => {
    expect(isReservedPress({ key: "R", ctrl: false, meta: false, alt: false, shift: false }, false)).toBe(false)
    expect(isReservedPress({ key: "F5", ctrl: false, meta: false, alt: false, shift: false }, false)).toBe(true)
  })
})
