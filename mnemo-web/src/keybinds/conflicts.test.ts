/**
 * Which shared chords are actually a problem.
 *
 * The rule is not "two actions, one chord": a Local action only matches while its own
 * namespace is active, so two of them in different namespaces never compete. Flagging
 * those would put a warning on most of the catalog and teach the reader to ignore it.
 */

import { describe, expect, it } from "vitest"

import { findConflicts } from "./conflicts"
import type { Keybind, KeybindScope } from "./types"

function action(
  actionId: string,
  chord: string | null,
  { scope = "Local" as KeybindScope, namespace = "editor", enabled = true } = {},
): Keybind {
  return {
    actionId,
    namespace,
    scope,
    enabled,
    allowedDuringTextCapture: false,
    toggleOnRepeat: false,
    bindings: chord ? [{ kind: "Chord", chord }] : [],
    isOverridden: false,
  }
}

describe("findConflicts", () => {
  it("reports nothing when every chord is unique", () => {
    expect(findConflicts([action("a", "Primary+A"), action("b", "Primary+B")]).size).toBe(0)
  })

  it("pairs two actions that share a chord in the same scope, naming each other", () => {
    const conflicts = findConflicts([action("a", "Primary+H"), action("b", "Primary+H")])
    expect(conflicts.get("a")).toEqual(["b"])
    expect(conflicts.get("b")).toEqual(["a"])
  })

  it("leaves two namespaces alone: they are never live at the same time", () => {
    const conflicts = findConflicts([
      action("a", "Primary+C", { namespace: "editor" }),
      action("b", "Primary+C", { namespace: "mindmap" }),
    ])
    expect(conflicts.size).toBe(0)
  })

  it("flags a local action against a global one, which fires over the top of it", () => {
    const conflicts = findConflicts([
      action("global.search", "Primary+K", { scope: "Global", namespace: "global" }),
      action("editor.thing", "Primary+K", { namespace: "editor" }),
    ])
    expect(conflicts.get("editor.thing")).toEqual(["global.search"])
    expect(conflicts.get("global.search")).toEqual(["editor.thing"])
  })

  it("ignores a disabled action: it answers to nothing, so it competes for nothing", () => {
    const conflicts = findConflicts([
      action("a", "Primary+H"),
      action("b", "Primary+H", { enabled: false }),
    ])
    expect(conflicts.size).toBe(0)
  })

  it("ignores an action with no chord at all", () => {
    expect(findConflicts([action("a", null), action("b", null)]).size).toBe(0)
  })

  it("names all of them when three collide, not just the previous one", () => {
    const conflicts = findConflicts([action("a", "Primary+H"), action("b", "Primary+H"), action("c", "Primary+H")])
    expect(conflicts.get("a")?.sort()).toEqual(["b", "c"])
    expect(conflicts.get("c")?.sort()).toEqual(["a", "b"])
  })
})
