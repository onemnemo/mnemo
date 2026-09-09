import type { WidgetManifest } from "../manifest"

/**
 * Targets for cards, sessions and minutes over a daily or weekly window.
 *
 * The targets are per day whichever window is shown. A weekly window is seven of each, so one set
 * of three serves both and a person who switches windows keeps the goals they set.
 */
export const studyGoalsManifest: WidgetManifest = {
  widgetId: "mnemo.study-goals",
  ns: "WidgetGoals",
  author: "Mnemo",
  category: "study",
  icon: "target",
  supportedSizes: [
    { columns: 2, rows: 1 },
    { columns: 1, rows: 2 },
    { columns: 2, rows: 2 },
  ],
  defaultSize: { columns: 2, rows: 1 },
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
    {
      key: "target_cards",
      labelKey: "SettingTargetCards",
      type: "range",
      defaultValue: "50",
      minimum: 5,
      maximum: 500,
      step: 5,
    },
    {
      key: "target_sessions",
      labelKey: "SettingTargetSessions",
      type: "range",
      defaultValue: "3",
      minimum: 1,
      maximum: 20,
      step: 1,
    },
    {
      key: "target_minutes",
      labelKey: "SettingTargetMinutes",
      type: "range",
      defaultValue: "30",
      minimum: 5,
      maximum: 480,
      step: 5,
    },
  ],
}
