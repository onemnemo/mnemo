import type { WidgetManifest } from "../manifest"

/** How much the scheduler will hand back over the coming days. */
export const forecastManifest: WidgetManifest = {
  widgetId: "mnemo.forecast",
  ns: "WidgetForecast",
  author: "Mnemo",
  category: "cards",
  icon: "calendar-clock",
  supportedSizes: [
    { columns: 2, rows: 1 },
    { columns: 4, rows: 1 },
  ],
  defaultSize: { columns: 2, rows: 1 },
  settings: [
    { key: "days", labelKey: "SettingDays", type: "range", defaultValue: "7", minimum: 7, maximum: 30, suffix: "d" },
  ],
}
