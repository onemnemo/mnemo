import type { WidgetManifest } from "../manifest"

/** A way into the assistant without leaving what you were doing. */
export const somaManifest: WidgetManifest = {
  widgetId: "mnemo.soma",
  ns: "WidgetSoma",
  author: "Mnemo",
  category: "soma",
  icon: "orbit",
  supportedSizes: [
    { columns: 2, rows: 1 },
    { columns: 1, rows: 1 },
  ],
  defaultSize: { columns: 2, rows: 1 },
}
