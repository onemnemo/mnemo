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
    category: "statistics",
    icon: `widgets/${widgetId}`,
    supportedSizes,
    defaultSize: supportedSizes[0],
  }
}

// Sized exactly as the template asks, which is the real registry's situation today.
const MANIFESTS: Record<string, WidgetManifest> = {
  "mnemo.flashcard-stats": manifestOf("mnemo.flashcard-stats", [
    { columns: 2, rows: 1 },
    { columns: 4, rows: 1 },
  ]),
  "mnemo.recent-decks": manifestOf("mnemo.recent-decks", [
    { columns: 2, rows: 1 },
    { columns: 2, rows: 2 },
  ]),
  "mnemo.recent-notes": manifestOf("mnemo.recent-notes", [
    { columns: 2, rows: 2 },
    { columns: 4, rows: 2 },
  ]),
  "mnemo.study-goals": {
    ...manifestOf("mnemo.study-goals", [
      { columns: 1, rows: 2 },
      { columns: 2, rows: 2 },
    ]),
    settings: [{ key: "dailyGoal", labelKey: "DailyGoal", type: "range", defaultValue: "20" }],
  },
  "mnemo.usage-summary": manifestOf("mnemo.usage-summary", [
    { columns: 1, rows: 2 },
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
  it("seeds the five template tiles at the template's own coordinates and order", () => {
    expect(seedDefaultLayout(lookup, nextId)).toEqual({
      schemaVersion: 3,
      profileId: "default",
      widgets: [
        {
          instanceId: "instance-1",
          widgetId: "mnemo.flashcard-stats",
          size: { columns: 2, rows: 1 },
          column: 0,
          row: 0,
          order: 0,
          settings: {},
        },
        {
          instanceId: "instance-2",
          widgetId: "mnemo.recent-decks",
          size: { columns: 2, rows: 1 },
          column: 2,
          row: 0,
          order: 1,
          settings: {},
        },
        {
          instanceId: "instance-3",
          widgetId: "mnemo.recent-notes",
          size: { columns: 2, rows: 2 },
          column: 0,
          row: 1,
          order: 2,
          settings: {},
        },
        {
          instanceId: "instance-4",
          widgetId: "mnemo.study-goals",
          size: { columns: 1, rows: 2 },
          column: 2,
          row: 1,
          order: 3,
          settings: { dailyGoal: "20" },
        },
        {
          instanceId: "instance-5",
          widgetId: "mnemo.usage-summary",
          size: { columns: 1, rows: 2 },
          column: 3,
          row: 1,
          order: 4,
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
      [2, 0],
      [0, 1],
      [2, 1],
      [3, 1],
    ])
  })

  it("snaps a template size the manifest no longer offers", () => {
    // recent-notes asks for 2x2. Offer 3x2 and 1x1 instead: both are one column away, so the row
    // distance decides and 3x2 wins.
    const narrowed: ManifestLookup = (widgetId) =>
      widgetId === "mnemo.recent-notes"
        ? manifestOf("mnemo.recent-notes", [
            { columns: 3, rows: 2 },
            { columns: 1, rows: 1 },
          ])
        : MANIFESTS[widgetId]

    const notes = seedDefaultLayout(narrowed, nextId).widgets.find((w) => w.widgetId === "mnemo.recent-notes")

    expect(notes?.size).toEqual({ columns: 3, rows: 2 })
  })

  it("drops an entry this build has no widget for, and closes the gap in order", () => {
    const withoutGoals: ManifestLookup = (widgetId) =>
      widgetId === "mnemo.study-goals" ? undefined : MANIFESTS[widgetId]

    const seeded = seedDefaultLayout(withoutGoals, nextId)

    expect(seeded.widgets.map((w) => w.widgetId)).toEqual([
      "mnemo.flashcard-stats",
      "mnemo.recent-decks",
      "mnemo.recent-notes",
      "mnemo.usage-summary",
    ])
    // Order is position among the widgets that seeded, not the template index, so nothing has to
    // cope with a hole at 3.
    expect(seeded.widgets.map((w) => w.order)).toEqual([0, 1, 2, 3])
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
