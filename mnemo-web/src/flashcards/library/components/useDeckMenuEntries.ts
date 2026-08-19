import { navigate } from "@/app/router"
import { useT } from "@/i18n/useT"
import { dialog } from "@/stores/dialog"
import type { DeckSummaryDto } from "@/api/types"

import { useDeleteDeck, useUpdateDeck } from "../../api"
import { useReviewSettings } from "../../presets/store"
import { useTransfer } from "../../transfer/store"
import { deckMenuItems, type DeckMenuEntry } from "./deck-row-menu-items"

/**
 * Binds the deck's verb list to the app: the prompts, the mutations and the
 * routes that the list itself deliberately knows nothing about. One row calls
 * this once and hands the result to both of its menus.
 */
export function useDeckMenuEntries(deck: DeckSummaryDto, upToDate: boolean): readonly DeckMenuEntry[] {
  const t = useT()
  const updateDeck = useUpdateDeck()
  const deleteDeck = useDeleteDeck()
  const fc = (key: string) => t("Flashcards", key)

  const rename = async () => {
    const value = await dialog.prompt({
      title: fc("RenameDeck"),
      defaultValue: deck.name,
      placeholder: fc("DeckNamePlaceholder"),
      confirmLabel: t("Common", "Save"),
      cancelLabel: t("Common", "Cancel"),
    })
    const name = value?.trim()
    if (!name || name === deck.name) return
    // Carries the icon through: the update replaces the deck header wholesale,
    // so anything left out is cleared rather than kept.
    await updateDeck.mutateAsync({
      id: deck.id,
      name,
      description: deck.description,
      tags: deck.tags,
      icon: deck.icon,
    })
  }

  const remove = async () => {
    const ok = await dialog.confirm({
      title: fc("DeleteDeck"),
      message: fc("DeleteDeckConfirm"),
      destructive: true,
      confirmLabel: t("Common", "Delete"),
      cancelLabel: t("Common", "Cancel"),
    })
    if (ok) await deleteDeck.mutateAsync(deck.id)
  }

  return deckMenuItems({
    deck,
    upToDate,
    t,
    on: {
      open: () => navigate("flashcard-deck", deck.id),
      review: () => navigate("flashcard-session", deck.id, "review", "due"),
      cramDue: () => navigate("flashcard-session", deck.id, "cram", "due"),
      cramAll: () => navigate("flashcard-session", deck.id, "cram", "all"),
      test: () => navigate("flashcard-test", deck.id),
      rename: () => void rename(),
      reviewSettings: () => useReviewSettings.getState().open(deck.id, deck.name),
      export: () =>
        useTransfer.getState().open({
          direction: "export",
          scope: { label: deck.name, deckIds: [deck.id] },
        }),
      remove: () => void remove(),
    },
  })
}
