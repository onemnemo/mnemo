import type { WidgetManifest } from "../manifest"

/**
 * Every day studied over the last year.
 *
 * No four-wide size. Seven rows of squares in a 1096x66 strip would need two and a half years of
 * history to fill; the shape does not want to be that wide, and offering the size would only ever
 * produce a half-empty tile.
 */
export const activityManifest: WidgetManifest = {
  widgetId: "mnemo.activity",
  ns: "WidgetActivity",
  author: "Mnemo",
  category: "study",
  icon: "calendar-days",
  supportedSizes: [
    { columns: 2, rows: 1 },
    { columns: 2, rows: 2 },
  ],
  defaultSize: { columns: 2, rows: 1 },
}
