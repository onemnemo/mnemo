/**
 * The board a profile gets on its first visit, ported from OverviewViewModel's
 * DefaultBoardTemplate and CreateDefaultLayout.
 *
 * A fresh profile has no stored row, and the desktop does not render an empty board over that: it
 * builds this layout, shows it, and writes it immediately, so the row exists after the first
 * visit. The port seeds on the client because the Host has no widget registry to snap sizes or
 * read setting defaults from.
 *
 * "Never saved" is the only load outcome this may run on. A failed read also arrives without a
 * board and seeding over it would replace a board that is still on disk.
 */

import type { OverviewLayoutDto, WidgetInstanceDto } from "@/api/types"

import { createDefaultSettings, nearestSupportedSize, type ManifestLookup } from "./widgets/manifest"

/** Mirrors OverviewLayout.CurrentSchemaVersion. Echoed on save; the host re-stamps it. */
export const OVERVIEW_SCHEMA_VERSION = 3

/** Mirrors OverviewLayout.DefaultProfileId. One board per install until profiles ship. */
export const DEFAULT_PROFILE_ID = "default"

/** One row of the fresh-board table: a widget type and where it starts out. */
export interface DefaultBoardEntry {
  widgetId: string
  column: number
  row: number
  columns: number
  rows: number
}

/**
 * Fresh-board template: the queue across the top, then the two quiet counters beside what you were
 * last doing, with the week's shape under them.
 *
 * It leads with Today because that is what an empty-handed reader needs first, but it is a default
 * and not a spine: every tile here can be resized, moved or thrown away, Today included. That is
 * the contract an extension store needs, since a widget somebody else wrote has to be able to
 * occupy the best spot on the screen.
 *
 * The coordinates are literal placements, not the -1 that WidgetInstance.column/row default to
 * elsewhere, so a seeded board is already fully placed before the layout engine sees it.
 */
export const DEFAULT_BOARD_TEMPLATE: readonly DefaultBoardEntry[] = [
  { widgetId: "mnemo.today", column: 0, row: 0, columns: 4, rows: 1 },
  { widgetId: "mnemo.streak", column: 0, row: 1, columns: 1, rows: 1 },
  { widgetId: "mnemo.flashcard-memory", column: 1, row: 1, columns: 1, rows: 1 },
  { widgetId: "mnemo.recent", column: 2, row: 1, columns: 2, rows: 1 },
  { widgetId: "mnemo.forecast", column: 0, row: 2, columns: 2, rows: 1 },
  { widgetId: "mnemo.activity", column: 2, row: 2, columns: 2, rows: 1 },
]

/** The starter board, built against whichever widgets this build actually registers. */
export function seedDefaultLayout(
  manifest: ManifestLookup,
  newInstanceId: () => string = () => crypto.randomUUID(),
): OverviewLayoutDto {
  const widgets: WidgetInstanceDto[] = []

  for (const entry of DEFAULT_BOARD_TEMPLATE) {
    const found = manifest(entry.widgetId)
    // A build that does not register this widget seeds a smaller board. Seeding the entry anyway
    // would put an unavailable tile on a board the user has not touched yet, and there would be no
    // manifest to size it from.
    if (!found) continue

    widgets.push({
      instanceId: newInstanceId(),
      widgetId: entry.widgetId,
      // The template's spans are a request, not a result. All five happen to be supported sizes
      // today, and stop being so the moment a manifest drops one.
      size: nearestSupportedSize(found, { columns: entry.columns, rows: entry.rows }),
      column: entry.column,
      row: entry.row,
      // Position among the widgets that actually seeded, so a skipped entry leaves no gap.
      order: widgets.length,
      settings: createDefaultSettings(found),
    })
  }

  return { schemaVersion: OVERVIEW_SCHEMA_VERSION, profileId: DEFAULT_PROFILE_ID, widgets }
}
