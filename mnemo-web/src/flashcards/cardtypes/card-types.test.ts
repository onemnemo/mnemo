import { describe, expect, it } from "vitest"

import type { CardTypeSummaryDto } from "@/api/types"

import {
  addField,
  addLayout,
  canSave,
  draftFromSummary,
  isDirty,
  marker,
  moveField,
  newDraft,
  patchField,
  patchLayout,
  problems,
  removeField,
  removeLayout,
  removedLayouts,
  requiredFieldChanges,
  toSaveDto,
  uniqueName,
  type CardTypeDraft,
} from "./card-types"

function summary(over: Partial<CardTypeSummaryDto["type"]> = {}, factCount = 0): CardTypeSummaryDto {
  return {
    type: {
      id: "vocab",
      name: "Vocabulary",
      isBuiltIn: false,
      fields: [
        { id: "word", name: "Word", hint: null },
        { id: "meaning", name: "Meaning", hint: "In your own words" },
      ],
      sortFieldId: "word",
      layouts: [
        { id: "recognition", name: "Recognition", front: "{{Word}}", back: "{{Meaning}}", requires: null },
      ],
      generator: null,
      generateFrom: null,
      createdAt: "2026-01-01T00:00:00+00:00",
      updatedAt: "2026-01-01T00:00:00+00:00",
      ...over,
    },
    factCount,
  }
}

function fresh(): CardTypeDraft {
  return newDraft("Untitled", "Front", "Back", "Recognition")
}

describe("card type drafts", () => {
  it("carries a stored type into a draft, hint and all", () => {
    const draft = draftFromSummary(summary({}, 7))

    expect(draft.serverId).toBe("vocab")
    expect(draft.dirty).toBe(false)
    expect(draft.factCount).toBe(7)
    expect(draft.fields.map((field) => field.hint)).toEqual(["", "In your own words"])
  })

  it("starts a new type on something usable rather than empty", () => {
    const draft = fresh()

    expect(problems(draft)).toEqual([])
    expect(draft.layouts[0].front).toBe(marker("Front"))
    expect(draft.sortFieldId).toBe(draft.fields[0].id)
    // Nothing is saved until Save, so a type that has never been sent has no id yet.
    expect(draft.serverId).toBeNull()
  })

  it("moves a field without losing the others", () => {
    const draft = moveField(fresh(), fresh().fields[0].id, 1)
    expect(draft.fields).toHaveLength(2)

    const start = fresh()
    const moved = moveField(start, start.fields[1].id, -1)
    expect(moved.fields.map((field) => field.name)).toEqual(["Back", "Front"])
  })

  it("refuses to move a field past either end", () => {
    const draft = fresh()
    expect(moveField(draft, draft.fields[0].id, -1)).toBe(draft)
    expect(moveField(draft, draft.fields[1].id, 1)).toBe(draft)
  })

  it("hands the sort field on when the field holding it is removed", () => {
    const draft = fresh()
    const next = removeField(draft, draft.fields[0].id)

    // A sort field naming a field that is gone is refused by the server, and by the time it is
    // refused the reader has already lost the field.
    expect(next.sortFieldId).toBe(next.fields[0].id)
    expect(problems(next)).toEqual([])
  })

  it("frees a card that was waiting on a field being removed", () => {
    const draft = fresh()
    const waiting = { ...draft, layouts: [{ ...draft.layouts[0], requires: draft.fields[1].id }] }

    const next = removeField(waiting, draft.fields[1].id)
    expect(next.layouts[0].requires).toBeNull()
  })

  it("carries a rename into the templates showing that field", () => {
    const draft = fresh()
    const renamed = patchField(draft, draft.fields[0].id, { name: "Term" })

    expect(renamed.layouts[0].front).toBe(marker("Term"))
    expect(renamed.layouts[0].back).toBe(marker("Back"))
  })

  it("still finds the markers after the name has been emptied and typed again", () => {
    const draft = fresh()
    // What typing over a selected name looks like one keystroke at a time.
    const cleared = patchField(draft, draft.fields[0].id, { name: "" })
    const retyped = patchField(cleared, draft.fields[0].id, { name: "Term" })

    expect(retyped.layouts[0].front).toBe(marker("Term"))
  })

  it("names every reason a type cannot be saved", () => {
    const draft = fresh()

    expect(problems({ ...draft, name: "   " })).toContain("CardTypesErrorName")
    expect(problems({ ...draft, fields: [] })).toContain("CardTypesErrorFields")
    expect(problems(patchField(draft, draft.fields[1].id, { name: "Front" }))).toContain(
      "CardTypesErrorFieldName",
    )
    expect(problems({ ...draft, sortFieldId: "gone" })).toContain("CardTypesErrorSortField")
    expect(problems(removeLayout(draft, draft.layouts[0].id))).toContain("CardTypesErrorCards")
    expect(problems(addLayout(draft, "Recall"))).toContain("CardTypesErrorCardSides")
  })

  it("names the cards an edit takes off a stored type", () => {
    const stored = summary({
      layouts: [
        { id: "recognition", name: "Recognition", front: "{{Word}}", back: "{{Meaning}}", requires: null },
        { id: "recall", name: "Recall", front: "{{Meaning}}", back: "{{Word}}", requires: null },
      ],
    })
    const draft = draftFromSummary(stored)

    expect(removedLayouts(stored.type, removeLayout(draft, "recall")).map((layout) => layout.name)).toEqual([
      "Recall",
    ])
    expect(removedLayouts(stored.type, draft)).toEqual([])

    // A generated type sends no layouts whatever its draft holds, so a stored row that still
    // carries some is not losing the cards they describe.
    const generated = draftFromSummary(summary({ generator: "cloze", generateFrom: "word", layouts: [] }))
    expect(removedLayouts(stored.type, generated)).toEqual([])
  })

  it("names the cards an edit has newly made conditional", () => {
    const stored = summary({
      layouts: [
        { id: "recognition", name: "Recognition", front: "{{Word}}", back: "{{Meaning}}", requires: null },
        { id: "recall", name: "Recall", front: "{{Meaning}}", back: "{{Word}}", requires: "meaning" },
      ],
    })
    const draft = draftFromSummary(stored)

    const required = patchLayout(draft, "recognition", { requires: "meaning" })
    expect(requiredFieldChanges(stored.type, required).map((layout) => layout.name)).toEqual(["Recognition"])

    // Moving a condition from one field to another is the same loss on a different field.
    const moved = patchLayout(draft, "recall", { requires: "word" })
    expect(requiredFieldChanges(stored.type, moved).map((layout) => layout.name)).toEqual(["Recall"])

    // Dropping a condition can only make more cards, and a layout the draft no longer lists is
    // the removal gate's to report.
    expect(requiredFieldChanges(stored.type, patchLayout(draft, "recall", { requires: null }))).toEqual([])
    expect(requiredFieldChanges(stored.type, removeLayout(draft, "recall"))).toEqual([])
    expect(requiredFieldChanges(stored.type, draft)).toEqual([])
  })

  it("asks nothing of a generated type's cards, because it has none to lay out", () => {
    const cloze = draftFromSummary(
      summary({ id: "cloze", generator: "cloze", generateFrom: "word", layouts: [] }),
    )

    expect(problems(cloze)).toEqual([])
    expect(toSaveDto(cloze).layouts).toEqual([])
  })

  it("trims what it sends and drops an empty hint rather than storing one", () => {
    const draft = patchField(addField(fresh(), "  Example  "), fresh().fields[0].id, {})
    const dto = toSaveDto({ ...draft, name: "  Vocabulary  " })

    expect(dto.name).toBe("Vocabulary")
    expect(dto.fields.at(-1)?.name).toBe("Example")
    expect(dto.fields.every((field) => field.hint === null)).toBe(true)
  })

  it("offers Save only when something was edited and every type is sound", () => {
    const stored = draftFromSummary(summary())
    expect(canSave([stored])).toBe(false)

    const edited = { ...stored, name: "Words", dirty: true }
    expect(canSave([edited])).toBe(true)

    // One type nobody can save blocks the whole dialog, because Save writes all of them.
    expect(canSave([edited, { ...stored, name: "" }])).toBe(false)
  })

  // Invalid drafts can still contain unsaved work.
  it("calls a set of types dirty as soon as one of them is, sound or not", () => {
    const broken = { ...draftFromSummary(summary()), name: "", dirty: true }

    expect(isDirty([broken])).toBe(true)
    expect(canSave([broken])).toBe(false)
  })

  it("names a new type something no other type is called", () => {
    expect(uniqueName("New card type", ["New card type", "New card type 2"])).toBe("New card type 3")
    expect(uniqueName("New card type", ["Basic"])).toBe("New card type")
  })
})
