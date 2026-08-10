/**
 * The board a fresh profile gets, and the two things about it that are easy to lose: the template
 * asks for sizes rather than dictating them, and an entry this build has no widget for is dropped
 * rather than seeded as a tile that cannot render.
 */

import { beforeEach, describe, expect, it } from "vitest"

import { DEFAULT_BOARD_TEMPLATE, seedDefaultLayout } from "./defaults"
import type { ManifestLookup, WidgetManifest } from "./widgets/manifest"

function manifestOf(widgetId: string, supportedSizes: WidgetManifest["supportedSizes"]): WidgetManifest {
  return {
    widgetId,
    ns: "Overview",
    author: "Mnemo",
    category: "study",
    icon: "square-stack",
    supportedSizes,
    defaultSize: supportedSizes[0],
  }
}

// Sized exactly as the template asks, which is the real registry's situation today.
const MANIFESTS: Record<string, WidgetManifest> = {
  "mnemo.today": manifestOf("mnemo.today", [
    { columns: 2, rows: 1 },
    { columns: 4, rows: 1 },
  ]),
  "mnemo.streak": manifestOf("mnemo.streak", [
    { columns: 1, rows: 1 },
    { columns: 2, rows: 1 },
  ]),
  "mnemo.flashcard-memory": manifestOf("mnemo.flashcard-memory", [
    { columns: 1, rows: 1 },
    { columns: 2, rows: 1 },
  ]),
  "mnemo.recent": manifestOf("mnemo.recent", [
    { columns: 2, rows: 1 },
    { columns: 2, rows: 2 },
  ]),
  "mnemo.forecast": {
    ...manifestOf("mnemo.forecast", [
      { columns: 2, rows: 1 },
      { columns: 4, rows: 1 },
    ]),
    settings: [{ key: "days", labelKey: "SettingDays", type: "range", defaultValue: "7" }],
  },
  "mnemo.activity": manifestOf("mnemo.activity", [
    { columns: 2, rows: 1 },
    { columns: 2, rows: 2 },
  ]),
}

const lookup: ManifestLookup = (widgetId) => MANIFESTS[widgetId]

let ids = 0
const nextId = (): string => `instance-${++ids}`

beforeEach(() => {
  ids = 0
})

describe("seedDefaultLayout", () => {
  it("seeds the template's tiles at its own coordinates and order", () => {
    expect(seedDefaultLayout(lookup, nextId)).toEqual({
      schemaVersion: 3,
      profileId: "default",
      widgets: [
        {
          instanceId: "instance-1",
          widgetId: "mnemo.today",
          size: { columns: 4, rows: 1 },
          column: 0,
          row: 0,
          order: 0,
          settings: {},
        },
        {
          instanceId: "instance-2",
          widgetId: "mnemo.streak",
          size: { columns: 1, rows: 1 },
          column: 0,
          row: 1,
          order: 1,
          settings: {},
        },
        {
          instanceId: "instance-3",
          widgetId: "mnemo.flashcard-memory",
          size: { columns: 1, rows: 1 },
          column: 1,
          row: 1,
          order: 2,
          settings: {},
        },
        {
          instanceId: "instance-4",
          widgetId: "mnemo.recent",
          size: { columns: 2, rows: 1 },
          column: 2,
          row: 1,
          order: 3,
          settings: {},
        },
        {
          instanceId: "instance-5",
          widgetId: "mnemo.forecast",
          size: { columns: 2, rows: 1 },
          column: 0,
          row: 2,
          order: 4,
          settings: { days: "7" },
        },
        {
          instanceId: "instance-6",
          widgetId: "mnemo.activity",
          size: { columns: 2, rows: 1 },
          column: 2,
          row: 2,
          order: 5,
          settings: {},
        },
      ],
    })
  })

  it("places the tiles rather than leaving them unassigned", () => {
    // -1 is what a freshly added widget carries; a seeded board is placed before the engine runs.
    const seeded = seedDefaultLayout(lookup, nextId)

    expect(seeded.widgets.map((w) => [w.column, w.row])).toEqual([
      [0, 0],
      [0, 1],
      [1, 1],
      [2, 1],
      [0, 2],
      [2, 2],
    ])
  })

  it("snaps a template size the manifest no longer offers", () => {
    // recent asks for 2x1. Offer 3x1 and 1x2 instead: both are one column away, so the row distance
    // decides and 3x1 wins.
    const narrowed: ManifestLookup = (widgetId) =>
      widgetId === "mnemo.recent"
        ? manifestOf("mnemo.recent", [
            { columns: 3, rows: 1 },
            { columns: 1, rows: 2 },
          ])
        : MANIFESTS[widgetId]

    const recent = seedDefaultLayout(narrowed, nextId).widgets.find((w) => w.widgetId === "mnemo.recent")

    expect(recent?.size).toEqual({ columns: 3, rows: 1 })
  })

  it("drops an entry this build has no widget for, and closes the gap in order", () => {
    const withoutRecent: ManifestLookup = (widgetId) =>
      widgetId === "mnemo.recent" ? undefined : MANIFESTS[widgetId]

    const seeded = seedDefaultLayout(withoutRecent, nextId)

    expect(seeded.widgets.map((w) => w.widgetId)).toEqual([
      "mnemo.today",
      "mnemo.streak",
      "mnemo.flashcard-memory",
      "mnemo.forecast",
      "mnemo.activity",
    ])
    // Order is position among the widgets that seeded, not the template index, so nothing has to
    // cope with a hole at 3.
    expect(seeded.widgets.map((w) => w.order)).toEqual([0, 1, 2, 3, 4])
  })

  it("seeds nothing at all when no widget is registered", () => {
    expect(seedDefaultLayout(() => undefined, nextId)).toEqual({
      schemaVersion: 3,
      profileId: "default",
      widgets: [],
    })
  })

  it("gives every tile its own instance id", () => {
    const seeded = seedDefaultLayout(lookup, nextId)

    expect(new Set(seeded.widgets.map((w) => w.instanceId)).size).toBe(DEFAULT_BOARD_TEMPLATE.length)
  })
})
