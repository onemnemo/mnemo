/**
 * The rules the spelling page reads the catalogue by.
 *
 * Two of them exist because of something that already went wrong. A region on
 * every row is noise until two entries share a name, and a scope select built
 * from the catalogue alone cannot show the scope a seeded word actually holds,
 * so changing that word's scope silently did nothing.
 */

import { describe, expect, it } from "vitest"

import type { PersonalWord, ProofingLanguage } from "@/notes/proofing/types"

import {
  ANY_LANGUAGE,
  describeState,
  labelOf,
  moveLanguage,
  pickerGroups,
  scopeLabel,
  scopeValues,
  withLanguage,
  withoutLanguage,
} from "./proofing-languages"

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
  language({
    id: "de-DE",
    name: "German",
    region: "Germany",
    installed: false,
    bundled: false,
    state: "absent",
    reasonKey: "proofing.language.notAvailableYet",
  }),
]

const st = (key: string) => `t:${key}`

describe("naming a language", () => {
  it("leaves out the region while the name tells it apart on its own", () => {
    expect(labelOf(CATALOG[0], CATALOG)).toBe("English")
    expect(labelOf(CATALOG[1], CATALOG)).toBe("Spanish")
  })

  it("appends the region to both entries that share a name", () => {
    const pool = [CATALOG[0], language({ id: "en-GB", region: "United Kingdom" }), CATALOG[1]]
    expect(labelOf(pool[0], pool)).toBe("English (United States)")
    expect(labelOf(pool[1], pool)).toBe("English (United Kingdom)")
    expect(labelOf(pool[2], pool)).toBe("Spanish")
  })

  it("names an entry that carries no region by its name alone", () => {
    const bare = language({ id: "eo", name: "Esperanto", region: "" })
    expect(labelOf(bare, [bare, language({ id: "eo-XX", name: "Esperanto", region: "" })])).toBe("Esperanto")
  })
})

describe("what a dictionary is doing", () => {
  it("reports ready and loading from the state alone", () => {
    expect(describeState(CATALOG[0], st, () => true)).toBe("t:ProofingStateReady")
    expect(describeState(CATALOG[1], st, () => true)).toBe("t:ProofingStateLoading")
  })

  it("gives the host's own reason for an absent one", () => {
    expect(describeState(CATALOG[2], st, () => true)).toBe("t:proofing.language.notAvailableYet")
  })

  // A key that does not resolve renders as the key itself, which reads as a bug.
  it("falls back rather than printing a reason key this build does not ship", () => {
    expect(describeState(CATALOG[2], st, () => false)).toBe("t:ProofingStateAbsent")
  })
})

describe("ordering the active set", () => {
  const active = ["en-US", "es-ES", "de-DE"]

  it("moves an entry one place in each direction", () => {
    expect(moveLanguage(active, "es-ES", -1)).toEqual(["es-ES", "en-US", "de-DE"])
    expect(moveLanguage(active, "es-ES", 1)).toEqual(["en-US", "de-DE", "es-ES"])
  })

  it("leaves the set untouched when the move runs off an end", () => {
    expect(moveLanguage(active, "en-US", -1)).toBe(active)
    expect(moveLanguage(active, "de-DE", 1)).toBe(active)
  })

  it("leaves the set untouched for an id that is not in it", () => {
    expect(moveLanguage(active, "nb-NO", -1)).toBe(active)
  })

  it("removes one entry and keeps the rest in order", () => {
    expect(withoutLanguage(active, "es-ES")).toEqual(["en-US", "de-DE"])
  })

  // The first entry suggests first, so adding a language is not a claim about
  // whose corrections should be offered.
  it("appends a new language rather than putting it first", () => {
    expect(withLanguage(["en-US"], "es-ES")).toEqual(["en-US", "es-ES"])
  })

  it("does not add a language that is already on", () => {
    expect(withLanguage(active, "en-US")).toBe(active)
  })
})

describe("grouping the picker", () => {
  it("splits the catalogue into what is installed and what is not", () => {
    const groups = pickerGroups(CATALOG, ["en-US"])
    expect(groups.installed.map((entry) => entry.language.id)).toEqual(["en-US", "es-ES"])
    expect(groups.unavailable.map((entry) => entry.id)).toEqual(["de-DE"])
  })

  it("marks an installed entry that is already in the active set", () => {
    const groups = pickerGroups(CATALOG, ["en-US"])
    expect(groups.installed.map((entry) => entry.active)).toEqual([true, false])
  })

  // Installed but still loading is still addable: a dictionary is only read once
  // something asks a question in it, so gating on ready made it unreachable.
  it("offers a bundled language that is still loading", () => {
    expect(pickerGroups(CATALOG, []).installed.map((entry) => entry.language.id)).toContain("es-ES")
  })
})

describe("the scopes a word can be given", () => {
  const words: PersonalWord[] = [
    { word: "mnemo", language: null, addedAt: "2026-01-01" },
    { word: "sillage", language: "en", addedAt: "2026-01-02" },
    { word: "cafe", language: "es-ES", addedAt: "2026-01-03" },
  ]

  it("offers every language on the machine, whether or not a word uses it", () => {
    expect(scopeValues([], CATALOG)).toEqual([ANY_LANGUAGE, "en-US", "es-ES"])
  })

  it("leaves out a language with nothing installed to check against", () => {
    expect(scopeValues([], CATALOG)).not.toContain("de-DE")
  })

  // Removal matches the stored string exactly, so a word seeded from the older
  // editor setting needs its bare code in the list or its own row cannot show it.
  it("keeps a stored scope the catalogue has no id for", () => {
    expect(scopeValues(words, CATALOG)).toEqual([ANY_LANGUAGE, "en-US", "es-ES", "en"])
  })

  it("does not repeat a stored scope that is already a catalogue id", () => {
    expect(scopeValues(words, CATALOG).filter((value) => value === "es-ES")).toHaveLength(1)
  })

  it("names a stored scope by its catalogue entry", () => {
    expect(scopeLabel("es-ES", CATALOG)).toBe("Spanish")
  })

  it("names a bare code by the entry sharing its primary subtag", () => {
    expect(scopeLabel("en", CATALOG)).toBe("English")
    expect(scopeLabel("EN", CATALOG)).toBe("English")
  })

  it("shows a code the catalogue knows nothing about as it is stored", () => {
    expect(scopeLabel("fr", CATALOG)).toBe("fr")
  })
})
