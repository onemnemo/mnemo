import type { WidgetManifest } from "../manifest"

/**
 * One deck pinned to the board with its queue.
 *
 * The only widget that may appear twice, and the test is not that a second one fits but that a
 * second one says something different: two spotlights pointed at two decks do.
 */
export const deckSpotlightManifest: WidgetManifest = {
  widgetId: "mnemo.deck-spotlight",
  ns: "WidgetDeck",
  author: "Mnemo",
  category: "cards",
  icon: "square-stack",
  supportedSizes: [
    { columns: 1, rows: 1 },
    { columns: 2, rows: 1 },
  ],
  defaultSize: { columns: 1, rows: 1 },
  allowMultiple: true,
  settings: [
    // No options and no meaningful default: the choice is one of the user's own decks, so the
    // config dialog resolves the list and an empty stored value means "whichever comes first".
    { key: "deck", labelKey: "SettingDeck", type: "choice", defaultValue: "", optionSource: "decks" },
  ],
}
