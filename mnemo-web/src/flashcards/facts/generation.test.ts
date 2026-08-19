import { describe, expect, it } from "vitest"

import type { CardAttachmentDto, CardTypeDto, CardTypeFieldDto, CardTypeLayoutDto } from "@/api/types"

import { clozeKey, clozeOrdinalFromKey, clozeOrdinals, dormant, generate, type FactLike } from "./generation"

/**
 * The same cases the server side generation is tested against. The two copies have to agree: this
 * one only says how many cards a save would make, the other one writes them.
 */

function field(id: string, name: string): CardTypeFieldDto {
  return { id, name, hint: null }
}

function layout(id: string, name: string, front: string, back: string, requires: string | null = null): CardTypeLayoutDto {
  return { id, name, front, back, requires }
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
  isBuiltIn: true,
  fields: [field("front", "Front"), field("back", "Back")],
  sortFieldId: "front",
  layouts: [layout("recognition", "Recognition", "{{Front}}", "{{Back}}")],
})

const basicReverse = cardType({
  ...basic,
  id: "basic-reverse",
  name: "Basic and reverse",
  layouts: [
    layout("recognition", "Recognition", "{{Front}}", "{{Back}}"),
    layout("recall", "Recall", "{{Back}}", "{{Front}}"),
  ],
})

const vocabulary = cardType({
  id: "vocabulary",
  name: "Vocabulary",
  isBuiltIn: true,
  fields: [field("word", "Word"), field("meaning", "Meaning"), field("example", "Example")],
  sortFieldId: "word",
  layouts: [
    layout("recognition", "Recognition", "{{Word}}", "{{Meaning}}\n\n{{Example}}"),
    layout("production", "Production", "{{Meaning}}", "{{Word}}"),
    layout("in-context", "In context", "{{Example}}", "{{Word}}\n\n{{Meaning}}", "example"),
  ],
})

const cloze = cardType({
  id: "cloze",
  name: "Cloze",
  isBuiltIn: true,
  fields: [field("text", "Text"), field("extra", "Extra")],
  sortFieldId: "text",
  layouts: [],
  generator: "cloze",
  generateFrom: "text",
})

function fact(values: Record<string, string>, media: Record<string, CardAttachmentDto[]> = {}): FactLike {
  return { values, media }
}

function image(id: string): CardAttachmentDto {
  return { id, side: "front", displayName: `${id}.png`, sizeBytes: 100, caption: null, assetId: id }
}

describe("ordinary layouts", () => {
  it("makes one card keyed by its layout", () => {
    const cards = generate(basic, fact({ front: "Which class blocks sodium?", back: "Class I" }))

    expect(cards).toHaveLength(1)
    expect(cards[0].key).toBe("recognition")
    expect(cards[0].layoutName).toBe("Recognition")
    expect(cards[0].front).toBe("Which class blocks sodium?")
    expect(cards[0].back).toBe("Class I")
  })

  it("makes both directions from one piece of material on a reverse type", () => {
    const cards = generate(basicReverse, fact({ front: "flecainide", back: "class Ic" }))

    expect(cards.map((card) => card.key)).toEqual(["recognition", "recall"])
    expect(cards[0].front).toBe("flecainide")
    expect(cards[1].front).toBe("class Ic")
  })

  it("gives a reversed card the media of the field its front names", () => {
    const trace = image("trace")
    const channel = image("channel")
    const cards = generate(
      basicReverse,
      fact({ front: "flecainide", back: "class Ic" }, { front: [trace], back: [channel] }),
    )

    // Keying media by field rather than by side is what makes this come out right without anything
    // in the generator knowing reversal exists.
    expect(cards[0].frontMedia).toEqual([trace])
    expect(cards[0].backMedia).toEqual([channel])
    expect(cards[1].frontMedia).toEqual([channel])
    expect(cards[1].backMedia).toEqual([trace])
  })

  it("collects the media of both fields a layout names, in template order", () => {
    const meaning = image("meaning")
    const example = image("example")
    const cards = generate(
      vocabulary,
      fact(
        { word: "arrhythmia", meaning: "irregular rhythm", example: "an arrhythmia on the trace" },
        { meaning: [meaning], example: [example] },
      ),
    )

    expect(cards.find((card) => card.key === "recognition")?.backMedia).toEqual([meaning, example])
  })
})

describe("required and dormant layouts", () => {
  it("makes no card for a layout whose required field is empty, and reports it waiting", () => {
    const material = fact({ word: "arrhythmia", meaning: "irregular rhythm" })

    const cards = generate(vocabulary, material)
    const waiting = dormant(vocabulary, material)

    expect(cards).toHaveLength(2)
    expect(cards.map((card) => card.key)).not.toContain("in-context")
    expect(waiting).toHaveLength(1)
    expect(waiting[0].layout.id).toBe("in-context")
    expect(waiting[0].requiredFieldName).toBe("Example")
  })

  it("switches the layout on once the required field is filled", () => {
    const material = fact({ word: "arrhythmia", meaning: "irregular rhythm", example: "an arrhythmia on the trace" })

    expect(generate(vocabulary, material)).toHaveLength(3)
    expect(dormant(vocabulary, material)).toEqual([])
  })

  it("does not count a field holding only whitespace as filled", () => {
    const cards = generate(vocabulary, fact({ word: "arrhythmia", meaning: "irregular rhythm", example: "   \n  " }))

    expect(cards.map((card) => card.key)).not.toContain("in-context")
  })

  it("reports no dormant layouts for a generated type", () => {
    expect(dormant(cloze, fact({ text: "no deletions here" }))).toEqual([])
  })
})

describe("rendering", () => {
  it("drops a marker naming a field the type lost, along with its blank line", () => {
    const type = cardType({
      id: "custom",
      fields: [field("a", "Alpha")],
      sortFieldId: "a",
      layouts: [layout("only", "Only", "{{Alpha}}", "{{Alpha}}\n\n{{Removed}}\n\nafter")],
    })

    expect(generate(type, fact({ a: "kept" }))[0].back).toBe("kept\n\nafter")
  })

  it("matches a field marker regardless of case and padding", () => {
    const type = cardType({
      id: "custom",
      fields: [field("a", "Alpha")],
      sortFieldId: "a",
      layouts: [layout("only", "Only", "{{ alpha }}", "{{ALPHA}}")],
    })

    const cards = generate(type, fact({ a: "kept" }))

    expect(cards[0].front).toBe("kept")
    expect(cards[0].back).toBe("kept")
  })
})

describe("cloze", () => {
  it("makes one card per deletion, in ascending order", () => {
    const cards = generate(
      cloze,
      fact({ text: "{{c2::Amiodarone}} is class {{c1::III}} and also {{c2::a beta blocker}}" }),
    )

    expect(cards.map((card) => card.key)).toEqual(["c1", "c2"])
    expect(cards.every((card) => card.layoutName === null)).toBe(true)
  })

  it("hides its own deletion and shows every other one", () => {
    const cards = generate(cloze, fact({ text: "{{c1::Lidocaine}} is class {{c2::Ib}}" }))

    expect(cards[0].front).toBe("[…] is class Ib")
    expect(cards[1].front).toBe("Lidocaine is class […]")
    expect(cards[0].back).toBe("Lidocaine is class Ib")
  })

  it("shows a hint in place of the placeholder", () => {
    const cards = generate(cloze, fact({ text: "blocks {{c1::sodium::which ion}} channels" }))

    expect(cards[0].front).toBe("blocks [which ion] channels")
    expect(cards[0].back).toBe("blocks sodium channels")
  })

  it("puts the extra field on the back of every card the material makes", () => {
    const cards = generate(
      cloze,
      fact({ text: "{{c1::Lidocaine}} is class {{c2::Ib}}", extra: "Shortens repolarisation." }),
    )

    expect(cards).toHaveLength(2)
    expect(cards.every((card) => card.back.endsWith("Shortens repolarisation."))).toBe(true)
  })

  it("keeps the source figure on the question side", () => {
    const trace = image("trace")
    const cards = generate(cloze, fact({ text: "the upstroke is phase {{c1::0}}" }, { text: [trace] }))

    // The figure is what the sentence is read against, so blanking the text must not take it away.
    expect(cards[0].frontMedia).toEqual([trace])
  })

  it("makes no cards from text with no deletion", () => {
    expect(generate(cloze, fact({ text: "nothing is deleted here" }))).toEqual([])
  })

  it("ignores a deletion number too large to be one rather than throwing", () => {
    expect(clozeOrdinals("{{c99999999999999999999::x}} and {{c2::y}}")).toEqual([2])
  })

  it("does not let a deletion span a line break", () => {
    // A marker left unclosed by a stray newline should read as text rather than swallowing the rest
    // of the note.
    expect(clozeOrdinals("{{c1::first\nsecond}}")).toEqual([])
  })
})

describe("stable keys", () => {
  it("survive an ordinary edit to the material", () => {
    const before = generate(cloze, fact({ text: "{{c1::Lidocaine}} is class {{c2::Ib}}" }))
    const after = generate(cloze, fact({ text: "{{c1::Lidocaine}} is a class {{c2::Ib}} agent" }))

    expect(after.map((card) => card.key)).toEqual(before.map((card) => card.key))
  })

  it("leave the other keys alone when one deletion is removed", () => {
    const before = generate(cloze, fact({ text: "{{c1::a}} {{c2::b}} {{c3::c}}" }))
    const after = generate(cloze, fact({ text: "{{c1::a}} b {{c3::c}}" }))

    expect(before.map((card) => card.key)).toEqual(["c1", "c2", "c3"])
    expect(after.map((card) => card.key)).toEqual(["c1", "c3"])
  })

  it("round trip through an ordinal", () => {
    expect(clozeKey(7)).toBe("c7")
    expect(clozeOrdinalFromKey("c7")).toBe(7)
    expect(clozeOrdinalFromKey("recognition")).toBeNull()
    expect(clozeOrdinalFromKey("c")).toBeNull()
  })
})

describe("occlusion", () => {
  it("makes one card carrying the prompt image", () => {
    const diagram = image("diagram")
    const type = cardType({
      id: "occ",
      name: "Occlusion",
      fields: [field("prompt", "Prompt"), field("notes", "Notes")],
      sortFieldId: "prompt",
      generator: "occlusion",
      generateFrom: "prompt",
    })

    const cards = generate(type, fact({ prompt: "Name the region", notes: "Anterior wall" }, { prompt: [diagram] }))

    expect(cards).toHaveLength(1)
    expect(cards[0].key).toBe("m1")
    expect(cards[0].front).toBe("Name the region")
    expect(cards[0].back).toBe("Anterior wall")
    expect(cards[0].frontMedia).toEqual([diagram])
  })
})
