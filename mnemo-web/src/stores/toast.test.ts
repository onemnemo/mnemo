// @vitest-environment jsdom

/**
 * App.EnableToasts turns off the pop-up card, not the notification list behind the
 * bell (its own description says so: "alerts appear only in the notification list").
 * So disabling it has to drop nothing from `history`, only skip `toasts`.
 */

import { afterEach, describe, expect, it } from "vitest"

import { useSettingsStore } from "@/settings/store"

import { useToastStore } from "./toast"

afterEach(() => {
  useSettingsStore.setState({ values: {}, secrets: {}, loaded: false, failed: false })
  useToastStore.setState({ toasts: [], history: [] })
})

describe("toast spawn", () => {
  it("shows a pop-up and records history when App.EnableToasts is on (the default)", () => {
    useToastStore.getState().spawn("info", "Saved")

    expect(useToastStore.getState().toasts).toHaveLength(1)
    expect(useToastStore.getState().history).toHaveLength(1)
  })

  it("skips the pop-up but still records history when App.EnableToasts is off", () => {
    useSettingsStore.setState((s) => ({ values: { ...s.values, "App.EnableToasts": false } }))

    useToastStore.getState().spawn("info", "Saved")

    expect(useToastStore.getState().toasts).toHaveLength(0)
    expect(useToastStore.getState().history).toHaveLength(1)
  })
})
