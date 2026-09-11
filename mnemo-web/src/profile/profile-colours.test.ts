import { describe, expect, it } from "vitest"

import { DEFAULT_PROFILE_COLOUR, profileColour, profileInitials } from "./profile-colours"

describe("profile colours", () => {
  it("keeps supported values and falls back from unknown ones", () => {
    expect(profileColour("moss")).toBe("moss")
    expect(profileColour("future-colour")).toBe(DEFAULT_PROFILE_COLOUR)
  })
})

describe("profile initials", () => {
  it("uses the first and last words", () => {
    expect(profileInitials("  Ada Lovelace  ")).toBe("AL")
    expect(profileInitials("Malley")).toBe("M")
  })

  it("keeps a whole Unicode character", () => {
    expect(profileInitials("😀 Student")).toBe("😀S")
  })

  it("falls back to the Mnemo initial for a blank name", () => {
    expect(profileInitials("   ")).toBe("M")
  })
})
