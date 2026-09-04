/**
 * Which languages the picker may offer.
 *
 * The reachability trap this guards: a dictionary only loads once something
 * asks a question in it, and the host warms only the language already in
 * force. Gating the picker on "ready" therefore made every other bundled
 * language permanently unselectable, since it had to be ready to be picked and
 * picked to become ready. Proved live: a hand-made check in es-ES flipped it to
 * ready and the picker then listed it.
 */

import { describe, expect, it } from "vitest"

import type { ProofingLanguage } from "@/notes/proofing/types"

import { languageChoices } from "./proofing-languages"

function language(over: Partial<ProofingLanguage> = {}): ProofingLanguage {
  return {
    id: "en-US",
    name: "English",
    region: "United States",
    installed: true,
    bundled: true,
    state: "ready",
    license: { name: "SCOWL", url: "https://example.com" },
    ...over,
  }
}

const CATALOG: ProofingLanguage[] = [
  language(),
  language({ id: "es-ES", name: "Spanish", region: "Spain", state: "loading" }),
  language({ id: "de-DE", name: "German", region: "Germany", installed: false, bundled: false, state: "absent" }),
]

describe("the language picker's choices", () => {
  it("offers a bundled language that is still loading", () => {
    const choices = languageChoices(CATALOG, "Preparing")
    expect(choices.map((choice) => choice.value)).toEqual(["en-US", "es-ES"])
  })

  it("says a loading one is still being prepared rather than hiding it", () => {
    const choices = languageChoices(CATALOG, "Preparing")
    expect(choices[0].label).toBe("English (United States)")
    expect(choices[1].label).toBe("Spanish (Spain) (Preparing)")
  })

  it("leaves out a language with nothing installed to load", () => {
    expect(languageChoices(CATALOG, "Preparing").map((choice) => choice.value)).not.toContain("de-DE")
  })

  it("offers nothing when no dictionary is installed", () => {
    expect(languageChoices([CATALOG[2]], "Preparing")).toEqual([])
  })
})
