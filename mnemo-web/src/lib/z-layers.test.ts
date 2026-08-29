import { describe, expect, it } from "vitest"

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
})
