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

import { SETTINGS_SCHEMA } from "./schema"
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
})
