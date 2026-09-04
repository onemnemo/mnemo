/**
 * The rules the spelling page reads the catalogue by.
 *
 * Two of them exist because of something that already went wrong. A region on
 * every row is noise until two entries share a name, and a scope select that
 * offers a seeded word's bare code beside the dictionary that answers for it
 * lists the same language twice, while one that does not offer it at all leaves
 * that word's row showing no value.
 */

import { describe, expect, it } from "vitest"

import type { ProofingLanguage } from "@/notes/proofing/types"

import {
  ANY_LANGUAGE,
  describeState,
  labelOf,
  moveLanguage,
  pickerGroups,
  resolveScope,
  scopeChange,
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
  // A working dictionary says nothing: "Ready" under every row is noise that buries
  // the one caption worth reading.
  it("says nothing about a ready one and reports a loading one", () => {
    expect(describeState(CATALOG[0], st, () => true)).toBeNull()
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

describe("which scope a word sits on", () => {
  it("puts an unscoped word on every language", () => {
    expect(resolveScope(null, CATALOG)).toBe(ANY_LANGUAGE)
  })

  it("keeps a scope that is already an installed id", () => {
    expect(resolveScope("es-ES", CATALOG)).toBe("es-ES")
  })

  // The host decides whether a scoped word applies to a language by primary
  // subtag, so a word seeded as `en` is scoped to the `en-US` on this machine.
  // Showing it any other way puts two options reading "English" in one list.
  it("puts a word seeded with a bare code on the dictionary that answers for it", () => {
    expect(resolveScope("en", CATALOG)).toBe("en-US")
    expect(resolveScope("EN", CATALOG)).toBe("en-US")
  })

  it("leaves a scope no installed language answers for as it is stored", () => {
    expect(resolveScope("de-DE", CATALOG)).toBe("de-DE")
    expect(resolveScope("fr", CATALOG)).toBe("fr")
  })

  // Otherwise a machine carrying both would move an en-US word onto whichever
  // of them the catalogue happened to list first.
  it("prefers the word's own id over another dictionary in the same language", () => {
    const pool = [language({ id: "en-GB", region: "United Kingdom" }), CATALOG[0]]
    expect(resolveScope("en-US", pool)).toBe("en-US")
    expect(resolveScope("en-GB", pool)).toBe("en-GB")
    expect(resolveScope("en", pool)).toBe("en-GB")
  })
})

describe("the scopes a word can be given", () => {
  it("offers every language on the machine and nothing else", () => {
    expect(scopeValues(null, CATALOG)).toEqual([ANY_LANGUAGE, "en-US", "es-ES"])
    expect(scopeValues("es-ES", CATALOG)).toEqual([ANY_LANGUAGE, "en-US", "es-ES"])
  })

  it("leaves out a language with nothing installed to check against", () => {
    expect(scopeValues(null, CATALOG)).not.toContain("de-DE")
  })

  it("does not offer a bare code beside the dictionary that answers for it", () => {
    expect(scopeValues("en", CATALOG)).toEqual([ANY_LANGUAGE, "en-US", "es-ES"])
  })

  // Otherwise the select is handed a value none of its options carry, and the
  // row shows nothing at all.
  it("adds one option for a scope no installed language answers for", () => {
    expect(scopeValues("fr", CATALOG)).toEqual([ANY_LANGUAGE, "en-US", "es-ES", "fr"])
  })

  it("always offers the option the word is sitting on", () => {
    for (const stored of [null, "en", "en-US", "es-ES", "de-DE", "fr"]) {
      expect(scopeValues(stored, CATALOG)).toContain(resolveScope(stored, CATALOG))
    }
  })

  it("never offers the same name twice", () => {
    for (const stored of [null, "en", "en-US", "es-ES", "de-DE", "fr"]) {
      const labels = scopeValues(stored, CATALOG).map((value) =>
        value === ANY_LANGUAGE ? "All languages" : scopeLabel(value, CATALOG),
      )
      expect(new Set(labels).size, `duplicate name for a word stored as ${stored}`).toBe(labels.length)
    }
  })

  it("names a stored scope by its catalogue entry", () => {
    expect(scopeLabel("es-ES", CATALOG)).toBe("Spanish")
    expect(scopeLabel("de-DE", CATALOG)).toBe("German")
  })

  it("names a bare code by the entry sharing its primary subtag", () => {
    expect(scopeLabel("en", CATALOG)).toBe("English")
    expect(scopeLabel("EN", CATALOG)).toBe("English")
  })

  it("shows a code the catalogue knows nothing about as it is stored", () => {
    expect(scopeLabel("fr", CATALOG)).toBe("fr")
  })
})

describe("changing a word's scope", () => {
  // A removal matches the stored string exactly, so it goes back as it stands
  // rather than as the option the row was showing.
  it("removes at the stored scope and adds at the chosen one", () => {
    expect(scopeChange("en", "es-ES", CATALOG)).toEqual({ from: "en", to: "es-ES" })
    expect(scopeChange("en", ANY_LANGUAGE, CATALOG)).toEqual({ from: "en", to: null })
    expect(scopeChange(null, "en-US", CATALOG)).toEqual({ from: null, to: "en-US" })
  })

  it("does nothing when the pick is the option already shown", () => {
    expect(scopeChange("es-ES", "es-ES", CATALOG)).toBeNull()
    expect(scopeChange(null, ANY_LANGUAGE, CATALOG)).toBeNull()
  })

  // The row for a word seeded as `en` sits on en-US, so picking en-US would
  // rewrite the stored string without changing anything the user can see.
  it("does nothing when a seeded word is set to the dictionary it already uses", () => {
    expect(scopeChange("en", "en-US", CATALOG)).toBeNull()
  })
})
