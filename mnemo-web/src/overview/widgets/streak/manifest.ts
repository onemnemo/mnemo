import type { WidgetManifest } from "../manifest"

/** Consecutive days studied, and how this week has gone. */
export const streakManifest: WidgetManifest = {
  widgetId: "mnemo.streak",
  ns: "WidgetStreak",
  author: "Mnemo",
  category: "study",
  icon: "flame",
  supportedSizes: [
    { columns: 1, rows: 1 },
    { columns: 2, rows: 1 },
  ],
  defaultSize: { columns: 1, rows: 1 },
}
