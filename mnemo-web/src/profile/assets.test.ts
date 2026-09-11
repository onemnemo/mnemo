import { describe, expect, it } from "vitest"

import {
  MAX_PROFILE_PICTURE_BYTES,
  customProfilePictureReference,
  customProfilePictureRequestPath,
  isCustomProfilePicture,
  profilePictureUploadProblem,
} from "./assets"

describe("uploaded profile picture references", () => {
  it("round-trips an asset id through the stored value", () => {
    const stored = customProfilePictureReference("a1b2c3.png")
    expect(isCustomProfilePicture(stored)).toBe(true)
    expect(customProfilePictureRequestPath(stored)).toBe("/api/profile/avatar/a1b2c3.png")
  })

  it("treats old bundled picture values as no picture", () => {
    const bundled = "avares://Mnemo.UI/Assets/ProfilePictures/img2.png"
    expect(isCustomProfilePicture(bundled)).toBe(false)
    expect(customProfilePictureRequestPath(bundled)).toBeNull()
  })

  it("refuses an id that would climb out of the profile directory", () => {
    expect(customProfilePictureRequestPath(customProfilePictureReference("../settings.json"))).toBeNull()
    expect(customProfilePictureRequestPath(customProfilePictureReference("nested/id.png"))).toBeNull()
    expect(customProfilePictureRequestPath(customProfilePictureReference("nested\\id.png"))).toBeNull()
    expect(customProfilePictureRequestPath(customProfilePictureReference(""))).toBeNull()
  })

  it("escapes what it does accept", () => {
    expect(customProfilePictureRequestPath(customProfilePictureReference("a b?c.png"))).toBe(
      "/api/profile/avatar/a%20b%3Fc.png",
    )
  })
})

describe("profile picture uploads", () => {
  const ok = { name: "me.png", size: 1024 }

  it("accepts an ordinary image", () => {
    expect(profilePictureUploadProblem(ok)).toBeNull()
    expect(profilePictureUploadProblem({ name: "ME.JPEG", size: 1024 })).toBeNull()
  })

  it("names the reason a file was refused", () => {
    expect(profilePictureUploadProblem({ ...ok, size: MAX_PROFILE_PICTURE_BYTES + 1 })).toBe(
      "ProfilePictureUploadTooLarge",
    )
    expect(profilePictureUploadProblem({ name: "notes.pdf", size: 1024 })).toBe(
      "ProfilePictureUploadUnsupported",
    )
    expect(profilePictureUploadProblem({ name: "screenshot", size: 1024 })).toBe(
      "ProfilePictureUploadUnsupported",
    )
  })

  it("allows a file exactly at the limit", () => {
    expect(profilePictureUploadProblem({ ...ok, size: MAX_PROFILE_PICTURE_BYTES })).toBeNull()
  })
})
