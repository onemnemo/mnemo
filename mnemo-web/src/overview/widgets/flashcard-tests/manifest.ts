import type { WidgetManifest } from "../manifest"

/** Test: the most recently tested deck's score, isolated from retention and effort counters. */
export const flashcardTestsManifest: WidgetManifest = {
  widgetId: "mnemo.flashcard-tests",
  ns: "FlashcardTests",
  author: "Mnemo",
  category: "statistics",
  icon: "widgets/flashcard-tests",
  supportedSizes: [
    { columns: 1, rows: 1 },
    { columns: 2, rows: 1 },
  ],
  defaultSize: { columns: 2, rows: 1 },
}
