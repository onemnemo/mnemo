import type { WidgetManifest } from "../manifest"

/** The last notes and decks touched, in one list. */
export const recentManifest: WidgetManifest = {
  widgetId: "mnemo.recent",
  ns: "WidgetRecent",
  author: "Mnemo",
  category: "study",
  icon: "clock",
  supportedSizes: [
    { columns: 2, rows: 1 },
    { columns: 2, rows: 2 },
    { columns: 4, rows: 1 },
  ],
  defaultSize: { columns: 2, rows: 2 },
  settings: [{ key: "count", labelKey: "SettingCount", type: "range", defaultValue: "6", minimum: 2, maximum: 6 }],
}
