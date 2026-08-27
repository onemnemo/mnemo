import { describe, expect, it } from "vitest"

import { canSave, isDirty, newDraft, type PresetDraft } from "./presets"

function clean(key: string): PresetDraft {
  return { ...newDraft(key, key), dirty: false }
}

describe("isDirty", () => {
  it("calls the drafts dirty when one of them was edited", () => {
    expect(isDirty({
      drafts: [clean("a"), newDraft("b", "B")],
      deckId: "deck",
      selectedKey: "a",
      originalPresetId: "a",
    })).toBe(true)
  })

  // Changing the selected preset is an unsaved edit even when no preset draft changed.
  it("calls them dirty when the deck was pointed at a different preset", () => {
    expect(isDirty({
      drafts: [clean("a"), clean("b")],
      deckId: "deck",
      selectedKey: "b",
      originalPresetId: "a",
    })).toBe(true)
  })

  it("calls them clean when nothing was touched", () => {
    expect(isDirty({
      drafts: [clean("a"), clean("b")],
      deckId: "deck",
      selectedKey: "a",
      originalPresetId: "a",
    })).toBe(false)
  })

  it("calls them clean when there is no deck to point anywhere", () => {
    expect(isDirty({
      drafts: [clean("a"), clean("b")],
      deckId: null,
      selectedKey: "b",
      originalPresetId: "a",
    })).toBe(false)
  })
})

describe("canSave", () => {
  it("offers Save on the same edits", () => {
    expect(canSave({
      drafts: [clean("a"), newDraft("b", "B")],
      stepsValid: true,
      deckId: "deck",
      selectedKey: "a",
      originalPresetId: "a",
    })).toBe(true)
  })

  // Invalid steps still count as unsaved work.
  it("refuses while the steps box does not parse", () => {
    const state = {
      drafts: [clean("a"), newDraft("b", "B")],
      deckId: "deck",
      selectedKey: "a",
      originalPresetId: "a",
    }

    expect(canSave({ ...state, stepsValid: false })).toBe(false)
    expect(isDirty(state)).toBe(true)
  })
})
