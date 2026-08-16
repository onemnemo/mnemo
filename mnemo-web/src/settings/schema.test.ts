/**
 * Invariants the settings tree has to hold, and one that spans the process boundary.
 *
 * A schema row naming a key the server does not expose looks perfect in review and
 * fails only when someone flips the switch: the PUT 404s, the optimistic write rolls
 * back, and the toast reads "Error". Nothing else in the build connects the two lists,
 * so the test reads the C# allowlist directly.
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { isRowHidden, SETTINGS_SCHEMA } from "./schema"
import type { SettingsRow } from "./types"

const REGISTRY = fileURLToPath(
  new URL("../../../Mnemo.Host/Settings/SettingsKeyRegistry.cs", import.meta.url),
)

/** Keys the SPA may read and write, taken from the registry's `new("Key", ...)` entries. */
function registeredKeys(): Set<string> {
  const source = readFileSync(REGISTRY, "utf8")
  return new Set([...source.matchAll(/new\("([^"]+)",\s*SettingValueKind\./g)].map((m) => m[1]))
}

function everyRow(): SettingsRow[] {
  return SETTINGS_SCHEMA.flatMap((category) =>
    category.groups.flatMap((group) => (group.master ? [group.master, ...group.rows] : group.rows)),
  )
}

describe("the settings schema", () => {
  it("names only keys the server exposes", () => {
    const exposed = registeredKeys()
    // Sanity: a regex that matched nothing would make this test pass on an empty set.
    expect(exposed.size).toBeGreaterThan(20)

    const missing = everyRow()
      .filter((row): row is Extract<SettingsRow, { key: string }> => "key" in row)
      .map((row) => row.key)
      .filter((key) => !exposed.has(key))

    expect(missing).toEqual([])
  })

  it("gives every category a unique id, since the nav selects by it", () => {
    const ids = SETTINGS_SCHEMA.map((category) => category.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("gives every category an icon, so the rail has no gaps in it", () => {
    expect(SETTINGS_SCHEMA.filter((category) => !category.icon)).toEqual([])
  })

  it("leaves a bespoke page's groups empty, because they would not be rendered", () => {
    for (const category of SETTINGS_SCHEMA.filter((c) => c.page)) {
      expect(category.groups).toEqual([])
    }
  })

  it("gives every dropdown and slider option a non-empty value", () => {
    // A Radix Select.Item with an empty-string value throws at render.
    for (const row of everyRow()) {
      if (row.kind !== "dropdown" && row.kind !== "slider") continue
      if (row.localizedValues) continue
      for (const option of row.options) {
        expect(option.value ?? option.labelText ?? option.label).toBeTruthy()
      }
    }
  })

  it("points every action row at a real link, or at nothing at all", () => {
    for (const row of everyRow()) {
      if (row.kind !== "action" || !row.href) continue
      expect(row.href).toMatch(/^https:\/\//)
    }
  })

  it("gives an action row a link or something to run, never both", () => {
    // The renderer resolves one press handler per row and takes the link first, so a
    // row carrying both would silently lose whichever the author meant.
    for (const row of everyRow()) {
      if (row.kind !== "action") continue
      expect(row.href && row.action, `${row.id} carries both a link and an action`).toBeFalsy()
    }
  })
})

describe("isRowHidden", () => {
  const context = { developerGateUnlocked: true }

  // Every setting the port does not read yet has to actually be hidden, not just
  // absent from some other checklist; this is what the renderer and search both
  // consult, so a miss here is a row visibly lying to the user again.
  const unwiredKeys = [
    "Markdown.BlockSpacing",
    "Markdown.LineHeight",
    "Markdown.LetterSpacing",
    "Markdown.CodeFontSize",
    "Markdown.MathFontSize",
    "Markdown.RenderMath",
    "App.EnableGamification",
    "Chat.StreamingReveal",
    "AI.WebSearch.Provider",
    "AI.WebSearch.SearxngUrl",
    "AI.WebSearch.BraveApiKey",
  ]

  it.each(unwiredKeys)("hides %s", (key) => {
    const row = everyRow().find((r) => "key" in r && r.key === key)
    expect(row, `no row named ${key}`).toBeDefined()
    expect(isRowHidden(row as SettingsRow, context)).toBe(true)
  })

  it("hides the app icon gallery, a custom row with no key of its own", () => {
    const row = everyRow().find((r) => r.kind === "custom" && r.id === "app-icon-gallery")
    expect(row).toBeDefined()
    expect(isRowHidden(row as SettingsRow, context)).toBe(true)
  })

  it("does not hide a sibling row that happens to share a namespace", () => {
    // AI.WebSearch.Enabled is wired server-side; only the provider it selects between
    // is not. Hiding by prefix would have caught this one by accident.
    const enabled = everyRow().find((r) => "key" in r && r.key === "AI.WebSearch.Enabled")
    expect(enabled).toBeDefined()
    expect(isRowHidden(enabled as SettingsRow, context)).toBe(false)

    // Markdown.FontSize is read by flashcards; only its Markdown-rendering siblings
    // above are unwired there.
    const baseFontSize = everyRow().find((r) => "key" in r && r.key === "Markdown.FontSize")
    expect(baseFontSize).toBeDefined()
    expect(isRowHidden(baseFontSize as SettingsRow, context)).toBe(false)
  })

  it("still gates the developer switch behind the tap gate, not the unwired list", () => {
    const row = everyRow().find((r) => "key" in r && r.key === "App.DeveloperMode")
    expect(row).toBeDefined()
    expect(isRowHidden(row as SettingsRow, { developerGateUnlocked: false })).toBe(true)
    expect(isRowHidden(row as SettingsRow, { developerGateUnlocked: true })).toBe(false)
  })
})
