import type { WidgetManifest } from "../manifest"

/** Recently practiced decks, joined with live deck metadata. */
export const recentDecksManifest: WidgetManifest = {
  widgetId: "mnemo.recent-decks",
  ns: "RecentDecks",
  author: "Mnemo",
  category: "activity",
  icon: "widgets/recent-decks",
  supportedSizes: [
    { columns: 2, rows: 1 },
    { columns: 2, rows: 2 },
  ],
  defaultSize: { columns: 2, rows: 1 },
  settings: [
    { key: "days_to_show", labelKey: "SettingDaysToShow", type: "range", defaultValue: "7", minimum: 1, maximum: 90 },
    {
      key: "sort_by",
      labelKey: "SettingSortBy",
      type: "choice",
      defaultValue: "date",
      options: [
        { value: "date", labelKey: "SettingSortByDate" },
        { value: "study_count", labelKey: "SettingSortByStudyCount" },
      ],
    },
    { key: "limit", labelKey: "SettingLimit", type: "range", defaultValue: "5", minimum: 1, maximum: 10 },
  ],
}
