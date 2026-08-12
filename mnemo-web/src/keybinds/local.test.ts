/**
 * Resolving a press against one namespace's local actions.
 *
 * The cases that matter are the ones that decide whether a canvas can hand its keyboard over to the
 * catalog at all: another module's identically bound action must not answer, a disabled one must not
 * answer, and a chord with a modifier must not be reachable by pressing the key on its own.
 */

import { describe, expect, it } from "vitest"

import { localMatcher } from "./local"
import type { Keybind } from "./types"

const bind = (actionId: string, chords: string[], over: Partial<Keybind> = {}): Keybind => ({
  actionId,
  namespace: "mindmap",
  scope: "Local",
  enabled: true,
  allowedDuringTextCapture: false,
  toggleOnRepeat: false,
  bindings: chords.map((chord) => ({ kind: "Chord", chord })),
  isOverridden: false,
  ...over,
})

/** A KeyboardEvent stand-in; only `code`, `key` and the modifier flags are read. */
const press = (code: string, modifiers: Partial<KeyboardEvent> = {}): KeyboardEvent =>
  ({ code, key: "", ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...modifiers }) as KeyboardEvent

describe("the matcher", () => {
  it("names the action a press is, and the chord it came in on", () => {
    const match = localMatcher([bind("mindmap.undo", ["Primary+Z"])], "mindmap")

    expect(match(press("KeyZ", { ctrlKey: true }))).toEqual({ actionId: "mindmap.undo", chord: "Primary+Z" })
  })

  it("answers on any of an action's chords", () => {
    const match = localMatcher([bind("mindmap.delete-selection", ["Delete", "Back"])], "mindmap")

    expect(match(press("Delete"))?.actionId).toBe("mindmap.delete-selection")
    expect(match(press("Backspace"))?.chord).toBe("Back")
  })

  it("says nothing for a key the namespace has not bound", () => {
    const match = localMatcher([bind("mindmap.undo", ["Primary+Z"])], "mindmap")

    expect(match(press("KeyJ"))).toBeNull()
  })

  it("leaves another surface's shortcuts to that surface", () => {
    const match = localMatcher([bind("notes.undo", ["Primary+Z"], { namespace: "notes" })], "mindmap")

    expect(match(press("KeyZ", { ctrlKey: true }))).toBeNull()
  })

  it("ignores the session's own shortcuts, which are dispatched for the whole app", () => {
    const match = localMatcher([bind("global.search", ["Primary+K"], { scope: "Global" })], "mindmap")

    expect(match(press("KeyK", { ctrlKey: true }))).toBeNull()
  })

  it("does not fire an action that has been turned off", () => {
    const match = localMatcher([bind("mindmap.radial", ["Q"], { enabled: false })], "mindmap")

    expect(match(press("KeyQ"))).toBeNull()
  })

  it("keeps a modified chord out of reach of the bare key", () => {
    const match = localMatcher([bind("mindmap.duplicate", ["Primary+D"])], "mindmap")

    expect(match(press("KeyD"))).toBeNull()
    expect(match(press("KeyD", { ctrlKey: true, shiftKey: true }))).toBeNull()
  })

  it("takes the first action bound to a chord two of them share", () => {
    const match = localMatcher([bind("mindmap.copy", ["Primary+C"]), bind("mindmap.connect", ["Primary+C"])], "mindmap")

    expect(match(press("KeyC", { ctrlKey: true }))?.actionId).toBe("mindmap.copy")
  })
})
