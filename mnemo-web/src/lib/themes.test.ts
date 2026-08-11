/**
 * Reading a stored theme value.
 *
 * Two things are being kept apart on purpose: what the user chose, which may be "follow
 * the OS", and what that renders as right now. Collapsing them at load is what turns a
 * "match system" preference into a frozen light or dark on the next launch.
 */

import { describe, expect, it } from "vitest"

import { DEFAULT_THEME, resolveThemeId, resolveThemePreference, themeFor } from "./themes"

describe("resolveThemeId", () => {
  it("passes a known id through", () => {
    expect(resolveThemeId("dark")).toBe("dark")
  })

  it("migrates the retired four-theme ids to whichever replaced them", () => {
    expect(resolveThemeId("dawn")).toBe("light")
    expect(resolveThemeId("noon")).toBe("light")
    expect(resolveThemeId("dusk")).toBe("dark")
    expect(resolveThemeId("ember")).toBe("dark")
  })

  it("falls back rather than applying a data-theme nothing is styled for", () => {
    expect(resolveThemeId("glass")).toBe(DEFAULT_THEME)
    expect(resolveThemeId(null)).toBe(DEFAULT_THEME)
    expect(resolveThemeId(undefined)).toBe(DEFAULT_THEME)
  })
})

describe("resolveThemePreference", () => {
  it("keeps 'system' as itself, so it can keep following the OS", () => {
    expect(resolveThemePreference("system")).toBe("system")
  })

  it("collapses everything else through resolveThemeId", () => {
    expect(resolveThemePreference("ember")).toBe("dark")
    expect(resolveThemePreference("nonsense")).toBe(DEFAULT_THEME)
  })
})

describe("themeFor", () => {
  it("returns an explicit preference unchanged", () => {
    expect(themeFor("dark")).toBe("dark")
    expect(themeFor("light")).toBe("light")
  })

  it("resolves 'system' to something renderable", () => {
    expect(["light", "dark"]).toContain(themeFor("system"))
  })
})
