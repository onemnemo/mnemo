import { navigate } from "@/app/router"
import { AppIcon } from "@/components/icon/AppIcon"
import { Menu, MenuContent, MenuItem, MenuSectionLabel, MenuSeparator, MenuSubMenu, MenuTrigger } from "@/components/ui/menu"
import { useT } from "@/i18n/useT"
import { dialog } from "@/stores/dialog"
import type { DeckSummaryDto } from "@/api/types"

import { useDeleteDeck, useUpdateDeck } from "../../api"
import { useReviewSettings } from "../../presets/store"

/**
 * The per-deck flyout. Study comes first and pre-highlights whichever mode fits
 * the deck's state: Review when cards are waiting, Cram once it is caught up.
 */
export function DeckRowMenu({ deck, upToDate }: { deck: DeckSummaryDto; upToDate: boolean }) {
  const t = useT()
  const updateDeck = useUpdateDeck()
  const deleteDeck = useDeleteDeck()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

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

  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={fc("DeckMenu")}
          title={fc("DeckMenu")}
          onClick={(event) => event.stopPropagation()}
          className="grid size-7 place-items-center rounded-md text-ink-3 opacity-0 transition-opacity group-hover/deck:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 hover:bg-frame-active hover:text-ink"
        >
          <AppIcon name="common/ellipsis" size={15} />
        </button>
      </MenuTrigger>

      <MenuContent align="end">
        <MenuSubMenu label={fc("Study")} icon="common/play-filled">
          <MenuItem
            icon="common/play"
            hint={fc("StudyMenuHintReview")}
            emphasis={!upToDate}
            onSelect={() => navigate("flashcard-session", deck.id, "review", "due")}
          >
            {fc("SessionReview")}
          </MenuItem>
          <MenuSeparator />
          <MenuSectionLabel>{fc("StudyPracticeSectionHeader")}</MenuSectionLabel>
          <MenuSubMenu label={fc("SessionCram")} icon="common/repeat" hint={fc("StudyMenuHintCram")} emphasis={upToDate}>
            <MenuSectionLabel>{fc("StudyCramSectionHeader")}</MenuSectionLabel>
            <MenuItem
              hint={deck.dueCounts.total.toLocaleString()}
              onSelect={() => navigate("flashcard-session", deck.id, "cram", "due")}
            >
              {fc("StudyCramDueCards")}
            </MenuItem>
            <MenuItem
              hint={deck.activeCards.toLocaleString()}
              onSelect={() => navigate("flashcard-session", deck.id, "cram", "all")}
            >
              {fc("StudyCramAllCards")}
            </MenuItem>
          </MenuSubMenu>
          <MenuItem
            icon="common/pencil"
            hint={fc("StudyMenuHintTest")}
            onSelect={() => navigate("flashcard-test", deck.id)}
          >
            {fc("SessionTest")}
          </MenuItem>
        </MenuSubMenu>

        <MenuSeparator />
        <MenuItem icon="flyout/open" onSelect={() => navigate("flashcard-deck", deck.id)}>
          {fc("OpenDeck")}
        </MenuItem>
        <MenuItem icon="flyout/rename" onSelect={() => void rename()}>
          {fc("RenameDeck")}
        </MenuItem>

        {/* Export and review settings arrive with the transfer and preset work
            later this phase; the rows stay visible but inert until then. */}
        <MenuSubMenu label={fc("Export")} icon="flyout/export">
          <MenuItem disabled>{fc("ExportFormatMnemo")}</MenuItem>
          <MenuItem disabled>{fc("ExportFormatAnki")}</MenuItem>
          <MenuItem disabled>{fc("ExportFormatCsv")}</MenuItem>
          <MenuItem disabled>{fc("ChooseFormat")}</MenuItem>
        </MenuSubMenu>
        <MenuItem
          icon="flyout/settings"
          onSelect={() => useReviewSettings.getState().open(deck.id, deck.name)}
        >
          {fc("ReviewSettingsMenu")}
        </MenuItem>

        <MenuSeparator />
        <MenuItem icon="common/trash" danger onSelect={() => void remove()}>
          {fc("DeleteDeck")}
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
