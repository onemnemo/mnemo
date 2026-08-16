import type { WidgetManifest } from "../manifest"

/** Lifetime launches and notes, plus per-area screen time over a configurable period. */
export const usageSummaryManifest: WidgetManifest = {
  widgetId: "mnemo.usage-summary",
  ns: "UsageSummary",
  author: "Mnemo",
  category: "study",
  icon: "layers",
  supportedSizes: [
    { columns: 1, rows: 2 },
    { columns: 2, rows: 1 },
    { columns: 2, rows: 2 },
  ],
  defaultSize: { columns: 1, rows: 2 },
  settings: [
    // A Choice rather than a Range, so the period is one of four values and never an arbitrary day
    // count. The stored value is still the number of days, as a string.
    {
      key: "period_days",
      labelKey: "SettingPeriod",
      type: "choice",
      defaultValue: "7",
      options: [
        { value: "7", labelKey: "SettingPeriod7" },
        { value: "14", labelKey: "SettingPeriod14" },
        { value: "30", labelKey: "SettingPeriod30" },
        { value: "90", labelKey: "SettingPeriod90" },
      ],
    },
    {
      key: "metric",
      labelKey: "SettingMetric",
      type: "choice",
      defaultValue: "review_count",
      options: [
        { value: "review_count", labelKey: "SettingMetricReviews" },
        { value: "time_spent", labelKey: "SettingMetricTime" },
      ],
    },
  ],
}
