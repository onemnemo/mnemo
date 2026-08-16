import type { IconName } from "@/components/icon/icon-registry"
import type { TranslateFn } from "@/i18n/types"
import type { DeckSummaryDto } from "@/api/types"

/**
 * The deck row's verbs, described once.
 *
 * The overflow button and the row's right-click menu are two Radix families that
 * cannot share components, so they share this instead: one list, rendered twice.
 * Every handler is injected, which keeps the list free of React and of the
 * router.
 */

export interface DeckMenuItem {
  readonly kind: "item"
  readonly id: string
  readonly label: string
  readonly icon?: IconName
  /** Right-aligned shortcut or count, as the desktop menus show. */
  readonly hint?: string
  /** Draws the item as the suggested action. */
  readonly emphasis?: boolean
  readonly danger?: boolean
  readonly disabled?: boolean
  readonly run?: () => void
}

export interface DeckMenuSubmenu {
  readonly kind: "submenu"
  readonly id: string
  readonly label: string
  readonly icon?: IconName
  readonly hint?: string
  readonly emphasis?: boolean
  readonly items: readonly DeckMenuEntry[]
}

export interface DeckMenuSection {
  readonly kind: "section"
  readonly id: string
  readonly label: string
}

export interface DeckMenuSeparator {
  readonly kind: "separator"
  readonly id: string
}

export type DeckMenuEntry = DeckMenuItem | DeckMenuSubmenu | DeckMenuSection | DeckMenuSeparator

export interface DeckMenuHandlers {
  readonly open: () => void
  readonly review: () => void
  readonly cramDue: () => void
  readonly cramAll: () => void
  readonly test: () => void
  readonly rename: () => void
  readonly reviewSettings: () => void
  readonly remove: () => void
}

/**
 * Study comes first and pre-highlights whichever mode fits the deck's state:
 * Review when cards are waiting, Cram once it is caught up.
 */
export function deckMenuItems({
  deck,
  upToDate,
  t,
  on,
}: {
  deck: DeckSummaryDto
  upToDate: boolean
  t: TranslateFn
  on: DeckMenuHandlers
}): readonly DeckMenuEntry[] {
  const fc = (key: string) => t("Flashcards", key)

  return [
    {
      kind: "submenu",
      id: "study",
      label: fc("Study"),
      icon: "common/play-filled",
      items: [
        {
          kind: "item",
          id: "study.review",
          label: fc("SessionReview"),
          icon: "common/play",
          hint: fc("StudyMenuHintReview"),
          emphasis: !upToDate,
          run: on.review,
        },
        { kind: "separator", id: "study.sep" },
        { kind: "section", id: "study.practice", label: fc("StudyPracticeSectionHeader") },
        {
          kind: "submenu",
          id: "study.cram",
          label: fc("SessionCram"),
          icon: "common/repeat",
          hint: fc("StudyMenuHintCram"),
          emphasis: upToDate,
          items: [
            { kind: "section", id: "study.cram.header", label: fc("StudyCramSectionHeader") },
            {
              kind: "item",
              id: "study.cram.due",
              label: fc("StudyCramDueCards"),
              hint: deck.dueCounts.total.toLocaleString(),
              run: on.cramDue,
            },
            {
              kind: "item",
              id: "study.cram.all",
              label: fc("StudyCramAllCards"),
              hint: deck.activeCards.toLocaleString(),
              run: on.cramAll,
            },
          ],
        },
        {
          kind: "item",
          id: "study.test",
          label: fc("SessionTest"),
          icon: "common/pencil",
          hint: fc("StudyMenuHintTest"),
          run: on.test,
        },
      ],
    },
    { kind: "separator", id: "sep.open" },
    { kind: "item", id: "open", label: fc("OpenDeck"), icon: "flyout/open", run: on.open },
    { kind: "item", id: "rename", label: fc("RenameDeck"), icon: "flyout/rename", run: on.rename },
    {
      // Export and review settings arrive with the transfer and preset work
      // later this phase; the rows stay visible but inert until then.
      kind: "submenu",
      id: "export",
      label: fc("Export"),
      icon: "flyout/export",
      items: [
        { kind: "item", id: "export.mnemo", label: fc("ExportFormatMnemo"), disabled: true },
        { kind: "item", id: "export.anki", label: fc("ExportFormatAnki"), disabled: true },
        { kind: "item", id: "export.csv", label: fc("ExportFormatCsv"), disabled: true },
        { kind: "item", id: "export.choose", label: fc("ChooseFormat"), disabled: true },
      ],
    },
    {
      kind: "item",
      id: "review-settings",
      label: fc("ReviewSettingsMenu"),
      icon: "settings-2",
      run: on.reviewSettings,
    },
    { kind: "separator", id: "sep.delete" },
    { kind: "item", id: "delete", label: fc("DeleteDeck"), icon: "common/trash", danger: true, run: on.remove },
  ]
}
