import { describe, expect, it } from "vitest"

import { defaultGroups, runSearch, scopeFor, score, splitMatch } from "./score"
import type { Hit } from "./types"

function hit(partial: Partial<Hit> & Pick<Hit, "id" | "kind" | "title">): Hit {
  return partial as Hit
}

const NOTES = [
  hit({ id: "n1", kind: "note", title: "The Krebs Cycle" }),
  hit({ id: "n2", kind: "note", title: "Bicycles" }),
  hit({ id: "n3", kind: "note", title: "Cycle" }),
]

describe("score", () => {
  it("ranks exact, prefix, word-start and mid-word matches in that order", () => {
    const ranked = [...NOTES].sort((a, b) => score(b, "cycle") - score(a, "cycle"))
    expect(ranked.map((h) => h.title)).toEqual(["Cycle", "The Krebs Cycle", "Bicycles"])
  })

  it("scores context and hidden keywords below any title match", () => {
    const byTitle = score(hit({ id: "a", kind: "note", title: "Anatomy" }), "anat")
    const byContext = score(hit({ id: "b", kind: "note", title: "Zebra", context: "Anatomy" }), "anat")
    const byKeyword = score(hit({ id: "c", kind: "note", title: "Zebra", keywords: "anatomy" }), "anat")

    expect(byTitle).toBeGreaterThan(byContext)
    expect(byContext).toBeGreaterThan(byKeyword)
    expect(byKeyword).toBeGreaterThan(0)
  })

  it("returns zero when nothing matches", () => {
    expect(score(hit({ id: "a", kind: "note", title: "Anatomy" }), "zzz")).toBe(0)
  })

  it("does not treat query punctuation as a pattern", () => {
    // Regex metacharacters reach the word-start test; unescaped, "a.b" would match
    // "axb" and, worse, "(" would throw.
    expect(() => score(hit({ id: "a", kind: "note", title: "Notes (draft)" }), "(")).not.toThrow()
    expect(score(hit({ id: "a", kind: "note", title: "axb" }), "a.b")).toBe(0)
  })
})

describe("splitMatch", () => {
  it("splits around the match, preserving the original casing", () => {
    expect(splitMatch("The Krebs Cycle", "krebs")).toEqual(["The ", "Krebs", " Cycle"])
  })

  it("puts everything in the leading segment when there is no match", () => {
    expect(splitMatch("Anatomy", "zzz")).toEqual(["Anatomy", "", ""])
    expect(splitMatch("Anatomy", "  ")).toEqual(["Anatomy", "", ""])
  })
})

describe("scopeFor", () => {
  it("maps the two prefixes and nothing else", () => {
    expect(scopeFor(">")).toBe("actions")
    expect(scopeFor("#")).toBe("tags")
    expect(scopeFor("a")).toBeNull()
    expect(scopeFor("")).toBeNull()
  })
})

describe("runSearch", () => {
  const POOL: Hit[] = [
    ...NOTES,
    hit({ id: "a1", kind: "action", title: "Toggle theme" }),
    hit({ id: "d1", kind: "deck", title: "Cycle deck", tags: ["biology"] }),
    hit({ id: "r1", kind: "route", title: "Notes" }),
  ]

  it("groups by kind in a fixed order, whatever the scores say", () => {
    const groups = runSearch(POOL, "cycle", null)
    expect(groups.map((g) => g.key)).toEqual(["note", "deck"])
  })

  it("returns nothing for an empty query outside a scope", () => {
    expect(runSearch(POOL, "   ", null)).toEqual([])
  })

  it("lists every action for a bare actions scope", () => {
    const groups = runSearch(POOL, "", "actions")
    expect(groups).toHaveLength(1)
    expect(groups[0].hits.map((h) => h.id)).toEqual(["a1"])
  })

  it("searches only actions inside the actions scope", () => {
    expect(runSearch(POOL, "cycle", "actions")).toEqual([])
  })

  it("matches tags, not titles, inside the tags scope", () => {
    const groups = runSearch(POOL, "bio", "tags")
    expect(groups[0].hits.map((h) => h.id)).toEqual(["d1"])
    // "cycle" is a title here, not a tag, so the tag scope must not find it.
    expect(runSearch(POOL, "cycle", "tags")).toEqual([])
  })

  it("lists everything tagged when the tags scope has no query yet", () => {
    expect(runSearch(POOL, "", "tags")[0].hits.map((h) => h.id)).toEqual(["d1"])
  })

  it("caps each group", () => {
    const many = Array.from({ length: 20 }, (_, i) => hit({ id: `n${i}`, kind: "note", title: `Cycle ${i}` }))
    expect(runSearch(many, "cycle", null)[0].hits).toHaveLength(6)
  })
})

describe("defaultGroups", () => {
  const POOL: Hit[] = [
    hit({ id: "r1", kind: "route", title: "Overview" }),
    hit({ id: "a1", kind: "action", title: "Toggle theme" }),
    hit({ id: "n1", kind: "note", title: "Anatomy" }),
  ]

  it("shows destinations and actions, but never the raw index", () => {
    const groups = defaultGroups(POOL, [])
    expect(groups.map((g) => g.key)).toEqual(["route", "action"])
  })

  it("puts recents first when there are any", () => {
    const groups = defaultGroups(POOL, [POOL[2]])
    expect(groups.map((g) => g.key)).toEqual(["recent", "route", "action"])
  })
})
