/**
 * The snapping rule, which is the port's alone: the Host has no manifests, so a size that is no
 * longer offered is only ever repaired here.
 */

import { describe, expect, it } from "vitest"

import { createDefaultSettings, nearestSupportedSize, type WidgetManifest } from "./manifest"

function manifestOf(supportedSizes: WidgetManifest["supportedSizes"]): WidgetManifest {
  return {
    widgetId: "test.widget",
    ns: "Test",
    author: "Mnemo",
    category: "study",
    icon: "widgets/test",
    supportedSizes,
    defaultSize: { columns: 1, rows: 1 },
  }
}

describe("nearestSupportedSize", () => {
  it("keeps a size the manifest already offers", () => {
    const manifest = manifestOf([
      { columns: 2, rows: 1 },
      { columns: 4, rows: 2 },
    ])

    expect(nearestSupportedSize(manifest, { columns: 4, rows: 2 })).toEqual({ columns: 4, rows: 2 })
  })

  it("decides on column distance before row distance", () => {
    // 3x9 is far away on rows and one column off; 1x1 is two columns off and closer on rows.
    const manifest = manifestOf([
      { columns: 1, rows: 1 },
      { columns: 3, rows: 9 },
    ])

    expect(nearestSupportedSize(manifest, { columns: 4, rows: 1 })).toEqual({ columns: 3, rows: 9 })
  })

  it("breaks a column tie on row distance", () => {
    const manifest = manifestOf([
      { columns: 1, rows: 4 },
      { columns: 3, rows: 2 },
    ])

    expect(nearestSupportedSize(manifest, { columns: 2, rows: 2 })).toEqual({ columns: 3, rows: 2 })
  })

  it("breaks a full tie on declaration order, which is preference order", () => {
    const manifest = manifestOf([
      { columns: 1, rows: 2 },
      { columns: 3, rows: 2 },
    ])

    expect(nearestSupportedSize(manifest, { columns: 2, rows: 2 })).toEqual({ columns: 1, rows: 2 })
  })

  it("falls back to the default size when the manifest offers none", () => {
    expect(nearestSupportedSize(manifestOf([]), { columns: 7, rows: 7 })).toEqual({ columns: 1, rows: 1 })
  })

  it("returns a copy, so storing the result cannot alias the manifest", () => {
    const manifest = manifestOf([{ columns: 2, rows: 1 }])
    const size = nearestSupportedSize(manifest, { columns: 2, rows: 1 })

    size.columns = 99

    expect(manifest.supportedSizes[0]).toEqual({ columns: 2, rows: 1 })
  })
})

describe("createDefaultSettings", () => {
  it("seeds every declared key with its schema default", () => {
    const manifest: WidgetManifest = {
      ...manifestOf([{ columns: 1, rows: 1 }]),
      settings: [
        { key: "range", labelKey: "Range", type: "choice", defaultValue: "week" },
        { key: "compact", labelKey: "Compact", type: "toggle", defaultValue: "false" },
      ],
    }

    expect(createDefaultSettings(manifest)).toEqual({ range: "week", compact: "false" })
  })

  it("gives a widget with no schema an empty bag rather than nothing", () => {
    expect(createDefaultSettings(manifestOf([{ columns: 1, rows: 1 }]))).toEqual({})
  })
})
