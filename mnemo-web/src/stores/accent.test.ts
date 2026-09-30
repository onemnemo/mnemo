// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"

import { resolveAccent } from "@/lib/accents"
import { useSettingsStore } from "@/settings/store"

import { ACCENT_SETTING_KEY, syncAccent } from "./accent"

const root = document.documentElement

afterEach(() => {
  useSettingsStore.setState({ values: {} })
  root.removeAttribute("data-accent")
  localStorage.clear()
})

describe("resolveAccent", () => {
  it("defaults to blue for absent or unknown values", () => {
    expect(resolveAccent(undefined)).toBe("blue")
    expect(resolveAccent("orange")).toBe("blue")
    expect(resolveAccent("teal")).toBe("teal")
  })
})

describe("syncAccent", () => {
  it("applies the stored accent and its first-paint hint", () => {
    useSettingsStore.setState({ values: { [ACCENT_SETTING_KEY]: "sage" } })
    const stop = syncAccent()

    expect(root.dataset.accent).toBe("sage")
    expect(localStorage.getItem("mnemo.accent")).toBe("sage")
    stop()
  })

  it("follows later changes, and the default clears both", () => {
    const stop = syncAccent()
    expect(root.hasAttribute("data-accent")).toBe(false)

    useSettingsStore.setState({ values: { [ACCENT_SETTING_KEY]: "plum" } })
    expect(root.dataset.accent).toBe("plum")

    useSettingsStore.setState({ values: { [ACCENT_SETTING_KEY]: "blue" } })
    expect(root.hasAttribute("data-accent")).toBe(false)
    expect(localStorage.getItem("mnemo.accent")).toBeNull()
    stop()
  })

  it("stops following once unsubscribed", () => {
    syncAccent()()
    useSettingsStore.setState({ values: { [ACCENT_SETTING_KEY]: "rose" } })
    expect(root.hasAttribute("data-accent")).toBe(false)
  })
})
