import { describe, expect, it } from "vitest"

import { createTranslate } from "@/i18n/translate"

import { maskMenuItems } from "./mask-menu"

const t = createTranslate({})
const hint = (action: string) => `<${action}>`

describe("maskMenuItems", () => {
  it("lists the six items in order with Delete last, apart and in the danger style", () => {
    const items = maskMenuItems(t, { cards: 1, isGroup: false }, hint)

    expect(items.map((item) => item.action)).toEqual(["rename", "duplicate", "group", "move-earlier", "move-later", "delete"])
    expect(items.map((item) => item.separatorBefore ?? false)).toEqual([false, false, false, false, false, true])
    expect(items.at(-1)?.danger).toBe(true)
    expect(items.slice(0, -1).some((item) => item.danger)).toBe(false)
  })

  it("carries the chord hints", () => {
    const items = maskMenuItems(t, { cards: 2, isGroup: false }, hint)
    expect(items.map((item) => item.hint)).toEqual(["<rename>", "<duplicate>", "<group>", "<move-earlier>", "<move-later>", "<delete>"])
  })

  it("disables Group for fewer than two cards and enables it from two", () => {
    expect(maskMenuItems(t, { cards: 1, isGroup: false }, hint)[2].disabled).toBe(true)
    expect(maskMenuItems(t, { cards: 2, isGroup: false }, hint)[2].disabled).toBe(false)
  })

  it("swaps Group for Ungroup when the selection is one group, never disabled", () => {
    const item = maskMenuItems(t, { cards: 1, isGroup: true }, hint)[2]
    expect(item.action).toBe("ungroup")
    expect(item.disabled).toBe(false)
  })
})
