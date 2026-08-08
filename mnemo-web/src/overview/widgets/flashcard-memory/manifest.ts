import type { WidgetManifest } from "../manifest"

/** Memory: true retention, sourced from review sessions only. */
export const flashcardMemoryManifest: WidgetManifest = {
  widgetId: "mnemo.flashcard-memory",
  ns: "FlashcardMemory",
  author: "Mnemo",
  category: "statistics",
  icon: "widgets/flashcard-memory",
  supportedSizes: [
    { columns: 1, rows: 1 },
    { columns: 2, rows: 1 },
  ],
  defaultSize: { columns: 2, rows: 1 },
}
