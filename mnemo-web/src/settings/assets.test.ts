import { describe, expect, it } from "vitest"

import {
  DEFAULT_PROFILE_PICTURE,
  MAX_AVATAR_BYTES,
  PROFILE_PICTURES,
  assetUrl,
  avatarUploadProblem,
  customAvatarReference,
  customAvatarRequestPath,
  isCustomAvatar,
} from "./assets"

describe("uploaded avatar references", () => {
  it("round-trips an asset id through the stored value", () => {
    const stored = customAvatarReference("a1b2c3.png")
    expect(isCustomAvatar(stored)).toBe(true)
    expect(customAvatarRequestPath(stored)).toBe("/api/profile/avatar/a1b2c3.png")
  })

  it("is distinguishable from every bundled value", () => {
    for (const bundled of [...PROFILE_PICTURES, DEFAULT_PROFILE_PICTURE]) {
      expect(isCustomAvatar(bundled)).toBe(false)
      expect(customAvatarRequestPath(bundled)).toBeNull()
    }
  })

  it("has no bundled URL, so the two resolvers never both answer", () => {
    expect(assetUrl(customAvatarReference("a1b2c3.png"))).toBeNull()
    expect(assetUrl(DEFAULT_PROFILE_PICTURE)).toBe("/profile-pictures/img2.png")
  })

  it("refuses an id that would climb out of the avatar directory", () => {
    expect(customAvatarRequestPath(customAvatarReference("../settings.json"))).toBeNull()
    expect(customAvatarRequestPath(customAvatarReference("nested/id.png"))).toBeNull()
    expect(customAvatarRequestPath(customAvatarReference("nested\\id.png"))).toBeNull()
    expect(customAvatarRequestPath(customAvatarReference(""))).toBeNull()
  })

  it("escapes what it does accept", () => {
    expect(customAvatarRequestPath(customAvatarReference("a b?c.png"))).toBe(
      "/api/profile/avatar/a%20b%3Fc.png",
    )
  })
})

describe("what may be uploaded as an avatar", () => {
  const ok = { name: "me.png", size: 1024 }

  it("accepts an ordinary image", () => {
    expect(avatarUploadProblem(ok)).toBeNull()
    expect(avatarUploadProblem({ name: "ME.JPEG", size: 1024 })).toBeNull()
  })

  it("names the reason a file was refused", () => {
    expect(avatarUploadProblem({ ...ok, size: MAX_AVATAR_BYTES + 1 })).toBe("AvatarUploadTooLarge")
    expect(avatarUploadProblem({ name: "notes.pdf", size: 1024 })).toBe("AvatarUploadUnsupported")
    expect(avatarUploadProblem({ name: "screenshot", size: 1024 })).toBe("AvatarUploadUnsupported")
  })

  it("allows a file exactly at the limit, which the host also accepts", () => {
    expect(avatarUploadProblem({ ...ok, size: MAX_AVATAR_BYTES })).toBeNull()
  })
})
