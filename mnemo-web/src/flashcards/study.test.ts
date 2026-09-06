import { describe, expect, it } from "vitest"

import type { CardDto } from "@/api/types"

import { answerText, maskCloze, progressFillWidth, promptText, revealCloze } from "./study"

function card(fields: Partial<CardDto>): CardDto {
  return {
    id: "c",
    deckId: "d",
    type: "classic",
    front: "",
    back: "",
    tags: [],
    state: "active",
    isFlagged: false,
    attachments: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...fields,
  }
}

// A cloze card as generation writes it: the front already masked, the back already filled in.
const generated = card({
  type: "cloze",
  front: "The capital of Japan is […]",
  back: "The capital of Japan is Tokyo",
})

describe("promptText", () => {
  it("shows a classic card's front as written", () => {
    expect(promptText(card({ front: "What is the capital of Japan?" }))).toBe("What is the capital of Japan?")
  })

  it("leaves a generated cloze front alone, since it is already masked", () => {
    expect(promptText(generated)).toBe("The capital of Japan is […]")
  })

  it("masks a marker generation could not read, so no markup reaches the screen", () => {
    const leaked = card({ type: "cloze", front: "Outside the {{c1::cell membrane\n}}sits the wall" })
    expect(promptText(leaked)).toBe("Outside the […]sits the wall")
  })
})

describe("answerText", () => {
  it("shows a classic card's back", () => {
    expect(answerText(card({ front: "Q", back: "A" }))).toBe("A")
  })

  it("shows the filled in sentence a cloze card stores on its back", () => {
    expect(answerText(generated)).toBe("The capital of Japan is Tokyo")
  })

  it("does not repeat the masked prompt, which is what it used to do", () => {
    expect(answerText(generated)).not.toBe(promptText(generated))
  })

  it("keeps the extra field that generation appended after a blank line", () => {
    const withExtra = card({
      type: "cloze",
      front: "The capital of Japan is […]",
      back: "The capital of Japan is Tokyo\n\nMoved from Kyoto in 1868",
    })
    expect(answerText(withExtra)).toBe("The capital of Japan is Tokyo\n\nMoved from Kyoto in 1868")
  })

  it("reads a marker left in the back rather than showing it raw", () => {
    const leaked = card({ type: "cloze", front: "x", back: "Outside the {{c1::cell membrane}} sits the wall" })
    expect(answerText(leaked)).toBe("Outside the **cell membrane** sits the wall")
  })

  it("falls back to the front for a card whose back was never written", () => {
    const unmaterialised = card({ type: "cloze", front: "The capital of Japan is {{c1::Tokyo}}", back: "" })
    expect(answerText(unmaterialised)).toBe("The capital of Japan is **Tokyo**")
  })
})

describe("maskCloze", () => {
  it("masks every deletion whatever its ordinal", () => {
    expect(maskCloze("{{c1::a}} and {{c2::b}}")).toBe("[…] and […]")
  })

  it("keeps adjacent deletions separate", () => {
    expect(maskCloze("{{c1::a}}{{c2::b}}")).toBe("[…][…]")
  })

  it("masks a deletion that spans lines", () => {
    expect(maskCloze("{{c1::first\nsecond}}")).toBe("[…]")
  })
})

describe("revealCloze", () => {
  it("brings the deletion back in bold", () => {
    expect(revealCloze("The capital is {{c1::Tokyo}}")).toBe("The capital is **Tokyo**")
  })

  it("leaves text carrying no deletions untouched", () => {
    expect(revealCloze("The capital is Tokyo")).toBe("The capital is Tokyo")
  })

  it("keeps whitespace the writer selected outside the markers, which will not otherwise pair", () => {
    expect(revealCloze("The capital is{{c1:: Tokyo }}today")).toBe("The capital is **Tokyo** today")
  })

  it("reveals an empty deletion as nothing rather than a stray pair of markers", () => {
    expect(revealCloze("Nothing here: {{c1::}}")).toBe("Nothing here: ")
  })
})

describe("progressFillWidth", () => {
  it("is empty before anything is graded", () => {
    expect(progressFillWidth(0, 10)).toBe(0)
  })

  it("fills the whole track at the end", () => {
    expect(progressFillWidth(10, 10)).toBe(160)
  })

  it("reads zero rather than dividing by an empty queue", () => {
    expect(progressFillWidth(0, 0)).toBe(0)
  })

  it("clamps a queue that grew past its own total", () => {
    expect(progressFillWidth(12, 10)).toBe(160)
  })
})
