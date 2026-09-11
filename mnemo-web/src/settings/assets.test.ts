import { describe, expect, it } from "vitest"

import {
  APP_ICONS,
  DEFAULT_APP_ICON,
  appIconName,
  assetUrl,
} from "./assets"

describe("app icon assets", () => {
  it("maps every stored icon to its static copy", () => {
    expect(APP_ICONS.map(assetUrl)).toEqual([
      "/app-icons/AppIconDawn.png",
      "/app-icons/AppIconDusk.png",
      "/app-icons/AppIconAurora.png",
      "/app-icons/AppIconEmber.png",
      "/app-icons/AppIconEarth.png",
    ])
  })

  it("names the default icon", () => {
    expect(appIconName(DEFAULT_APP_ICON)).toBe("Dawn")
  })

  it("does not turn an unrelated value into an asset URL", () => {
    expect(assetUrl("profile-asset:a1b2c3.png")).toBeNull()
  })
})
