/**
 * KeyboardPage renders one row per server-side keybind action, and every row's label
 * and category come from t(NS, action.labelKey) / t(NS, action.categoryKey) with
 * NS = "Keybinds" (see labelsFor / groupByCategory in KeyboardPage.tsx). The actions
 * themselves are declared across three separate C# modules (CoreUIModule, NotesModule,
 * MindmapModule), and nothing connects a manifest entry's DisplayLabelKey /
 * DisplayCategoryKey to whether that key actually exists in a bundle. A new action
 * shipped without a translation renders its own id, e.g. `editor.bold`, and its
 * section header renders `category.formatting`: this is the single most visible way
 * the Keyboard page can look broken to a new user, so this test enumerates every
 * action the page can render and pins its label and category against the real bundle.
 */
import { describe, expect, it } from "vitest"

import { mergedEnglishBundle, readRepoText, resolves } from "@/i18n/test-bundle"

const PAGE_SOURCE = readRepoText("mnemo-web", "src", "settings", "components", "pages", "KeyboardPage.tsx")
const CORE_MODULE = readRepoText("Mnemo.UI", "Modules", "CoreUIModule.cs")
const NOTES_MODULE = readRepoText("Mnemo.UI", "Modules", "Notes", "NotesModule.cs")
const MINDMAP_MODULE = readRepoText("Mnemo.UI", "Modules", "Mindmap", "MindmapModule.cs")

interface ActionLabel {
  actionId: string
  labelKey: string
  categoryKey: string
}

/**
 * Actions registered with explicit string literals: `ActionId = "...", DisplayLabelKey
 * = "...", DisplayCategoryKey = "..."` somewhere in the same object initializer. Reads
 * forward from each `ActionId = "..."` to the next one (or a generous tail) instead of
 * brace-matching, since the initializer nests further object literals (Bindings) whose
 * own braces would confuse a naive `{...}` match.
 */
function parseExplicitDefinitions(source: string): ActionLabel[] {
  const starts = [...source.matchAll(/ActionId\s*=\s*"([^"]+)"/g)]
  const results: ActionLabel[] = []

  starts.forEach((match, index) => {
    const from = match.index ?? 0
    const to = starts[index + 1]?.index ?? from + 800
    const slice = source.slice(from, to)
    const labelKey = slice.match(/DisplayLabelKey\s*=\s*"([^"]+)"/)?.[1]
    const categoryKey = slice.match(/DisplayCategoryKey\s*=\s*"([^"]+)"/)?.[1]
    if (labelKey && categoryKey) results.push({ actionId: match[1], labelKey, categoryKey })
  })

  return results
}

/**
 * CoreUIModule's EditorKeybindManifest.Chords: `new("id", "gesture", descriptionKeyOrNull
 * [, "categoryKey"])`, registered with `DisplayLabelKey = chord.ActionId` and a
 * `DisplayCategoryKey` that defaults to "category.formatting" when the 4th argument is
 * omitted (see the record's default in CoreUIModule.cs).
 */
function parseEditorChords(source: string): ActionLabel[] {
  const array = source.match(/Chords\s*=\s*\[([\s\S]*?)\];/)?.[1] ?? ""
  const entries = array.matchAll(/new\("([^"]+)",\s*"[^"]+",\s*(?:null|"[^"]+")(?:,\s*"([^"]+)")?\)/g)
  return [...entries].map((entry) => ({
    actionId: entry[1],
    labelKey: entry[1],
    categoryKey: entry[2] ?? "category.formatting",
  }))
}

/**
 * MindmapModule's MindmapKeybindManifest.Definitions: every entry is `Chords("id", ...
 * gestures)`, and that local helper always sets DisplayLabelKey to the action id and
 * DisplayCategoryKey to "category.mindmap".
 */
function parseMindmapChords(source: string): ActionLabel[] {
  const array = source.match(/Definitions\s*=\s*\[([\s\S]*?)\];/)?.[1] ?? ""
  const ids = [...array.matchAll(/Chords\("([^"]+)"/g)].map((entry) => entry[1])
  return ids.map((actionId) => ({ actionId, labelKey: actionId, categoryKey: "category.mindmap" }))
}

function allKeybindActions(): ActionLabel[] {
  return [
    ...parseExplicitDefinitions(CORE_MODULE),
    ...parseEditorChords(CORE_MODULE),
    ...parseExplicitDefinitions(NOTES_MODULE),
    ...parseMindmapChords(MINDMAP_MODULE),
  ]
}

const CHROME_KEYS = [
  "keybindManager.searchPlaceholder",
  "keybindManager.resetAll",
  "keybindManager.editShortcut",
  "keybindManager.editorScopeLocked",
  "keybindManager.editorPressShortcut",
  "keybindManager.editorRestoreDefault",
] as const

describe("KeyboardPage translations", () => {
  const bundle = mergedEnglishBundle()
  const actions = allKeybindActions()

  it("finds a non-trivial number of actions to check", () => {
    // A parsing regression that silently matched nothing would make every test below
    // pass vacuously.
    expect(actions.length).toBeGreaterThan(30)
  })

  it("still resolves its own chrome strings under Keybinds", () => {
    expect(PAGE_SOURCE).toMatch(/const NS = "Keybinds"/)
    for (const key of CHROME_KEYS) {
      expect(resolves(bundle, "Keybinds", key), `Keybinds/${key} is missing from the merged bundle`).toBe(true)
    }
  })

  it.each(allKeybindActions())("gives $actionId a real label and category", ({ actionId, labelKey, categoryKey }) => {
    expect(resolves(bundle, "Keybinds", labelKey), `Keybinds/${labelKey} (label for ${actionId}) is missing`).toBe(
      true,
    )
    expect(
      resolves(bundle, "Keybinds", categoryKey),
      `Keybinds/${categoryKey} (category for ${actionId}) is missing`,
    ).toBe(true)
  })
})
