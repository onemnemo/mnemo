// @vitest-environment jsdom

/**
 * The notes workspace reopens the note it remembers, so after a render failure there the
 * memory has to go, or the next visit lands on the same throw. A failure anywhere else is
 * not a reason to close the note.
 */

import { afterEach, describe, expect, it } from "vitest"

import { readLastNoteId, rememberLastNoteId } from "@/notes/workspace/session"

import { forgetRouteMemory } from "./route-memory"

afterEach(() => {
  localStorage.clear()
})

describe("forgetRouteMemory", () => {
  it("forgets the remembered note when the notes route failed", () => {
    rememberLastNoteId("note-that-throws")

    forgetRouteMemory("notes")

    expect(readLastNoteId()).toBeNull()
  })

  it("leaves the remembered note alone when another route failed", () => {
    rememberLastNoteId("note-abc")

    forgetRouteMemory("flashcard-deck")
    forgetRouteMemory("overview")

    expect(readLastNoteId()).toBe("note-abc")
  })
})
