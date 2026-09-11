import { describe, expect, it } from "vitest"

import { readRepoText } from "@/i18n/test-bundle"

const CULTURES = ["en", "de", "es", "ja", "nb"] as const
const KEYS = [
  "ProfilePicture",
  "ProfilePictureDescription",
  "ProfilePictureAdd",
  "ProfilePictureChange",
  "ProfilePictureRemove",
  "ProfilePictureUploadTooLarge",
  "ProfilePictureUploadUnsupported",
  "ProfilePictureUploadFailed",
  "ProfileColour",
  "ProfileColourDescription",
  "ProfileColourDefault",
  "ProfileColourClay",
  "ProfileColourSand",
  "ProfileColourMoss",
  "ProfileColourSky",
  "ProfileColourIris",
] as const

describe("profile translations", () => {
  it.each(CULTURES)("provides the complete %s profile copy", (culture) => {
    const bundle = JSON.parse(
      readRepoText("Mnemo.Infrastructure", "Languages", `${culture}.json`),
    ) as { Settings?: Record<string, string> }

    for (const key of KEYS) {
      expect(bundle.Settings?.[key], `${culture} is missing Settings/${key}`).toBeTruthy()
    }
  })
})
