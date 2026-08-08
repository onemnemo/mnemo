import type { WidgetManifest } from "../manifest"

/** Progress bars for practice targets over a daily or weekly window. */
export const studyGoalsManifest: WidgetManifest = {
  widgetId: "mnemo.study-goals",
  ns: "StudyGoals",
  author: "Mnemo",
  category: "activity",
  icon: "widgets/study-goals",
  supportedSizes: [
    { columns: 1, rows: 2 },
    { columns: 2, rows: 1 },
    { columns: 2, rows: 2 },
  ],
  defaultSize: { columns: 1, rows: 2 },
  settings: [
    {
      key: "goal_type",
      labelKey: "SettingGoalType",
      type: "choice",
      defaultValue: "daily",
      options: [
        { value: "daily", labelKey: "SettingGoalTypeDaily" },
        { value: "weekly", labelKey: "SettingGoalTypeWeekly" },
      ],
    },
    {
      key: "metric",
      labelKey: "SettingMetric",
      type: "choice",
      defaultValue: "cards",
      options: [
        { value: "cards", labelKey: "SettingMetricCards" },
        { value: "minutes", labelKey: "SettingMetricMinutes" },
      ],
    },
  ],
}
