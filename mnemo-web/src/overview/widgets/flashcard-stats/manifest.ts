import type { WidgetManifest } from "../manifest"

/** Activity: reps, minutes, sessions and streak across all study modes. */
export const flashcardStatsManifest: WidgetManifest = {
  widgetId: "mnemo.flashcard-stats",
  ns: "FlashcardStats",
  author: "Mnemo",
  category: "statistics",
  icon: "widgets/flashcard-stats",
  supportedSizes: [
    { columns: 2, rows: 1 },
    { columns: 4, rows: 1 },
    { columns: 1, rows: 2 },
  ],
  defaultSize: { columns: 2, rows: 1 },
}
