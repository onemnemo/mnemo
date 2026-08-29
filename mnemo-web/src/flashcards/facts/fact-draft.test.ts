import { describe, expect, it } from "vitest"

import type { CardTypeDto, CardTypeFieldDto } from "@/api/types"

import type { DraftAttachment } from "../editor/draft"
import { droppedCardCount, resolveDraftDeck, retypeDraft, type FactDraft } from "./fact-draft"

function field(id: string, name: string): CardTypeFieldDto {
  return { id, name, hint: null }
}

function cardType(over: Partial<CardTypeDto> & Pick<CardTypeDto, "id">): CardTypeDto {
  return {
    name: over.id,
    isBuiltIn: false,
    fields: [],
    sortFieldId: "",
    layouts: [],
    generator: null,
    generateFrom: null,
    createdAt: "2026-01-01T00:00:00+00:00",
    updatedAt: "2026-01-01T00:00:00+00:00",
    ...over,
  }
}

const basic = cardType({
  id: "basic",
  name: "Basic",
  fields: [field("front", "Front"), field("back", "Back")],
  sortFieldId: "front",
  layouts: [{ id: "recognition", name: "Recognition", front: "{{Front}}", back: "{{Back}}", requires: null }],
})

const cloze = cardType({
  id: "cloze",
  name: "Cloze",
  fields: [field("text", "Text"), field("extra", "Extra")],
  sortFieldId: "text",
  generator: "cloze",
  generateFrom: "text",
})

const vocabulary = cardType({
  id: "vocabulary",
  name: "Vocabulary",
  fields: [field("word", "Word"), field("meaning", "Meaning"), field("example", "Example")],
  sortFieldId: "word",
  layouts: [
    { id: "recognition", name: "Recognition", front: "{{Word}}", back: "{{Meaning}}", requires: null },
    { id: "in-context", name: "In context", front: "{{Example}}", back: "{{Word}}", requires: "example" },
  ],
})

function draft(values: Record<string, string>, media: Record<string, DraftAttachment[]> = {}): FactDraft {
  return { deckId: "deck-1", typeId: "basic", values, media, tags: [] }
}

function attachment(key: string): DraftAttachment {
  return { key, id: key, assetId: key, side: "front", displayName: key, sizeBytes: 1024, caption: null }
}

describe("resolveDraftDeck", () => {
  it("keeps the deck the material names when the collection still has it", () => {
    expect(resolveDraftDeck("deck-1", ["deck-1", "deck-2"], "deck-2")).toBe("deck-1")
  })

  it("falls back to the card's deck when the one the material names is gone", () => {
    expect(resolveDraftDeck("deck-1", ["deck-2", "deck-3"], "deck-2")).toBe("deck-2")
  })

  it("waits for the decks to load rather than treating an empty list as a missing deck", () => {
    expect(resolveDraftDeck("deck-1", [], "deck-2")).toBe("deck-1")
  })
})

describe("retypeDraft", () => {
  it("carries Front and Back into Text and Extra, which no name would have matched", () => {
    const next = retypeDraft(draft({ front: "The capital of Japan is Tokyo", back: "Since 1868" }), basic, cloze)

    expect(next.typeId).toBe("cloze")
    expect(next.values).toEqual({ text: "The capital of Japan is Tokyo", extra: "Since 1868" })
  })

  it("keeps a field's material with its name rather than its position", () => {
    const swapped = cardType({
      id: "swapped",
      fields: [field("f1", "Back"), field("f2", "Front")],
      sortFieldId: "f1",
    })

    const next = retypeDraft(draft({ front: "question", back: "answer" }), basic, swapped)

    expect(next.values).toEqual({ f2: "question", f1: "answer" })
  })

  it("matches a name whatever its casing or padding", () => {
    const shouty = cardType({ id: "shouty", fields: [field("f1", " FRONT ")], sortFieldId: "f1" })

    expect(retypeDraft(draft({ front: "question", back: "answer" }), basic, shouty).values).toEqual({ f1: "question" })
  })

  it("drops material the new type has no field for", () => {
    const single = cardType({ id: "single", fields: [field("only", "Only")], sortFieldId: "only" })

    expect(retypeDraft(draft({ front: "question", back: "answer" }), basic, single).values).toEqual({ only: "question" })
  })

  it("takes a field's pictures along with its text", () => {
    const next = retypeDraft(draft({ front: "question" }, { front: [attachment("a1")] }), basic, cloze)

    expect(next.media).toEqual({ text: [attachment("a1")] })
  })

  it("leaves the material alone when the type has not actually changed", () => {
    expect(retypeDraft(draft({ front: "question" }), basic, basic).values).toEqual({ front: "question" })
  })

  it("keeps what is typed when the type it is coming from has not loaded yet", () => {
    const next = retypeDraft(draft({ front: "question" }), undefined, cloze)

    expect(next.typeId).toBe("cloze")
    expect(next.values).toEqual({ front: "question" })
  })
})

describe("droppedCardCount", () => {
  const material = { type: basic, draft: draft({ front: "The capital of Japan is {{c1::Tokyo}}", back: "answer" }) }

  it("counts the card a change of type stops producing", () => {
    const after = { type: cloze, draft: retypeDraft(material.draft, basic, cloze) }

    expect(droppedCardCount(material, after)).toBe(1)
  })

  it("counts nothing when the type has not changed", () => {
    expect(droppedCardCount(material, material)).toBe(0)
  })

  it("counts one per deletion when a cloze card goes back to being classic", () => {
    const before = {
      type: cloze,
      draft: draft({ text: "{{c1::a}} and {{c2::b}}", extra: "" }),
    }
    const after = { type: basic, draft: retypeDraft(before.draft, cloze, basic) }

    expect(droppedCardCount(before, after)).toBe(2)
  })

  it("counts the card a removed deletion stops making", () => {
    const before = { type: cloze, draft: draft({ text: "{{c1::a}} and {{c2::b}}", extra: "" }) }
    const after = { type: cloze, draft: draft({ text: "{{c1::a}} and b", extra: "" }) }

    expect(droppedCardCount(before, after)).toBe(1)
  })

  it("counts the card a cleared field stops making", () => {
    const filled = { word: "Haus", meaning: "house", example: "Das Haus ist alt." }
    const before = { type: vocabulary, draft: draft(filled) }
    const after = { type: vocabulary, draft: draft({ ...filled, example: "" }) }

    expect(droppedCardCount(before, after)).toBe(1)
  })
})
