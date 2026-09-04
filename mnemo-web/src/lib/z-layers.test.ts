import { describe, expect, it } from "vitest"

import { MODAL_MENU_CLASS } from "@/components/ui/modal-menu"

import { Z_LAYERS } from "./z-layers"

describe("the app's stacking order", () => {
  it("keeps the toast stack and the dialog queue above the takeover band", () => {
    expect(Z_LAYERS.toast).toBeGreaterThan(Z_LAYERS.onboarding)
    expect(Z_LAYERS.toast).toBeGreaterThan(Z_LAYERS.modal)
    expect(Z_LAYERS.dialog).toBeGreaterThan(Z_LAYERS.onboarding)
    expect(Z_LAYERS.dialog).toBeGreaterThan(Z_LAYERS.modal)
  })

  it("keeps the dialog queue above the toast stack, as before this fix", () => {
    expect(Z_LAYERS.dialog).toBeGreaterThan(Z_LAYERS.toast)
  })

  it("puts a menu opened inside a modal above it, and below the palette", () => {
    expect(MODAL_MENU_CLASS).toBe(`z-[${String(Z_LAYERS.modalMenu)}]`)
    expect(Z_LAYERS.modalMenu).toBeGreaterThan(Z_LAYERS.modal)
    expect(Z_LAYERS.modalMenu).toBeLessThan(Z_LAYERS.toast)
  })
})
