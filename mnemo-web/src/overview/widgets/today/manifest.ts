import type { WidgetManifest } from "../manifest"

/** What is waiting right now across every deck, and the button that starts it. */
export const todayManifest: WidgetManifest = {
  widgetId: "mnemo.today",
  ns: "WidgetToday",
  author: "Mnemo",
  category: "study",
  icon: "play",
  supportedSizes: [
    { columns: 2, rows: 1 },
    { columns: 4, rows: 1 },
    { columns: 2, rows: 2 },
  ],
  defaultSize: { columns: 4, rows: 1 },
}
