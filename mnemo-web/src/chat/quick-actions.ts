/**
 * The starting points offered on an empty conversation.
 *
 * Each one sends its prompt straight away rather than filling the composer: they are
 * examples of what to ask, and a half-written question you then have to finish is a worse
 * offer than a real one.
 *
 * Data, not markup, because the page shows all four and the dock has room for two.
 */
export interface QuickAction {
  /** Chat-namespace key for the label. */
  titleKey: string
  /** Chat-namespace key for the message that gets sent. */
  promptKey: string
  icon: string
}

export const QUICK_ACTIONS: readonly QuickAction[] = [
  { titleKey: "QuickActionFlashcards", promptKey: "QuickActionFlashcardsPrompt", icon: "sidebar/flashcard" },
  { titleKey: "QuickActionSummarize", promptKey: "QuickActionSummarizePrompt", icon: "common/file-text" },
  { titleKey: "QuickActionQuiz", promptKey: "QuickActionQuizPrompt", icon: "common/pencil" },
  { titleKey: "QuickActionConceptMap", promptKey: "QuickActionConceptMapPrompt", icon: "common/sitemap" },
]
