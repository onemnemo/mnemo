import type { WidgetManifest } from "../manifest"

/**
 * Retention: how much of what gets reviewed is recalled, sourced from review sessions only.
 *
 * The id is still `flashcard-memory` although the widget is called Retention now. The id is what
 * a saved board stores, and renaming it would turn every tile on every existing board into an
 * unavailable one to buy a tidier string nobody sees.
 */
export const flashcardMemoryManifest: WidgetManifest = {
  widgetId: "mnemo.flashcard-memory",
  ns: "WidgetRetention",
  author: "Mnemo",
  category: "cards",
  icon: "target",
  supportedSizes: [
    { columns: 1, rows: 1 },
    { columns: 2, rows: 1 },
  ],
  defaultSize: { columns: 2, rows: 1 },
}
