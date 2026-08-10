import type { WidgetManifest } from "../manifest"

/**
 * The most recently created or edited notes. The one widget whose default is not its smallest size.
 *
 * It keeps its three settings (window, ordering, count) where the design draws one. That is a
 * superset rather than a shortcut, and dropping two of them would take working configuration off
 * boards that already use it.
 */
export const recentNotesManifest: WidgetManifest = {
  widgetId: "mnemo.recent-notes",
  ns: "RecentNotes",
  author: "Mnemo",
  category: "notes",
  icon: "file-text",
  supportedSizes: [
    { columns: 2, rows: 1 },
    { columns: 2, rows: 2 },
  ],
  defaultSize: { columns: 2, rows: 2 },
  settings: [
    { key: "days_to_show", labelKey: "SettingDaysToShow", type: "range", defaultValue: "7", minimum: 1, maximum: 90 },
    {
      key: "sort_by",
      labelKey: "SettingSortBy",
      type: "choice",
      defaultValue: "date",
      options: [
        { value: "date", labelKey: "SettingSortByDate" },
        { value: "modified", labelKey: "SettingSortByModified" },
      ],
    },
    { key: "limit", labelKey: "SettingLimit", type: "range", defaultValue: "5", minimum: 1, maximum: 10 },
  ],
}
