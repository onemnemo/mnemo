/**
 * The command palette's built-in actions, pinned against the real bundle.
 *
 * getActions runs at render time because the titles are translated, so a typo in
 * the namespace or key would not fail to compile, it would just render the key
 * itself in the palette (`ActionToggleTheme` instead of "Toggle theme"). This
 * resolves the real GlobalSearch keys the same way CommandPalette does, and
 * checks getActions actually produces translated text rather than a miss.
 */
import { describe, expect, it } from "vitest"

import { createTranslate } from "@/i18n/translate"
import { mergedEnglishBundle, resolves } from "@/i18n/test-bundle"

import { getActions } from "./actions"

const ACTION_KEYS = ["ActionToggleTheme", "ActionToggleThemeContext", "ActionToggleSidebar"] as const

describe("command palette actions", () => {
  const bundle = mergedEnglishBundle()

  it.each(ACTION_KEYS)("resolves GlobalSearch/%s", (key) => {
    expect(resolves(bundle, "GlobalSearch", key), `GlobalSearch/${key} is missing`).toBe(true)
  })

  it("gives every action its translated text, not a raw key", () => {
    const actions = getActions(createTranslate(bundle))

    expect(actions.map((action) => action.id)).toEqual(["action:theme", "action:sidebar"])
    expect(actions[0].title).toBe("Toggle theme")
    expect(actions[0].context).toBe("Light and dark")
    expect(actions[1].title).toBe("Toggle sidebar")
  })
})
