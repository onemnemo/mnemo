import type { WidgetManifest } from "../manifest"

/**
 * Cards failed again and again, ranked by how often.
 *
 * The only widget on the board that says what to *fix* rather than how it went, which is why it
 * earns a place next to five that report.
 */
export const leechesManifest: WidgetManifest = {
  widgetId: "mnemo.leeches",
  ns: "WidgetLeeches",
  author: "Mnemo",
  category: "cards",
  icon: "triangle-alert",
  supportedSizes: [
    { columns: 2, rows: 1 },
    { columns: 2, rows: 2 },
  ],
  defaultSize: { columns: 2, rows: 1 },
}
