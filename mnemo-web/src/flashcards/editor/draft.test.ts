import { describe, expect, it } from "vitest"

import { draftFromUpload } from "./draft"

describe("draftFromUpload", () => {
  it("gives the same picture attached twice two keys", () => {
    const asset = { assetId: "same.png", displayName: "same.png", sizeBytes: 3 }
    const first = draftFromUpload(asset, "front")
    const second = draftFromUpload(asset, "front")
    expect(first.assetId).toBe(second.assetId)
    expect(first.key).not.toBe(second.key)
  })
})
