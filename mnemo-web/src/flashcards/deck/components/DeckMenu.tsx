import type { DeckSummaryDto } from "@/api/types"
import { navigate } from "@/app/router"
import { AppIcon } from "@/components/icon/AppIcon"
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuSubMenu, MenuTrigger } from "@/components/ui/menu"
import { useT } from "@/i18n/useT"
import { dialog } from "@/stores/dialog"

import { useDecksQuery, useDeleteDeck, useFoldersQuery, useMoveDeck, useUpdateDeck } from "../../api"
import { useReviewSettings } from "../../presets/store"
import { useTransfer } from "../../transfer/store"
import { fetchAllCardIds, useSuspendCards } from "../api"

/** The deck's own flyout, opened from the ellipsis button beside Study. */
export function DeckMenu({ deck }: { deck: DeckSummaryDto }) {
  const t = useT()
  const folders = useFoldersQuery()
  const decks = useDecksQuery()
  const updateDeck = useUpdateDeck()
  const moveDeck = useMoveDeck()
  const deleteDeck = useDeleteDeck()
  const suspendCards = useSuspendCards(deck.id)
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

  const moveToFolder = async (folderId: string | null) => {
    if (folderId === deck.folderId) return
    // Land at the end of the target folder, the way a newly created deck does.
    const sortOrder =
      Math.max(-1, ...(decks.data ?? []).filter((d) => d.folderId === folderId).map((d) => d.sortOrder)) + 1
    await moveDeck.mutateAsync({ id: deck.id, folderId, sortOrder })
  }

  const suspendAll = async () => {
    const ids = await fetchAllCardIds(deck.id)
    if (ids.length > 0) await suspendCards.mutateAsync({ cardIds: ids, value: true })
  }

  const remove = async () => {
    const ok = await dialog.confirm({
      title: fc("DeleteDeck"),
      message: fc("DeleteDeckConfirm"),
      destructive: true,
      confirmLabel: t("Common", "Delete"),
      cancelLabel: t("Common", "Cancel"),
    })
    if (!ok) return
    await deleteDeck.mutateAsync(deck.id)
    navigate("flashcards")
  }

  const sortedFolders = [...(folders.data ?? [])].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={fc("DeckMenu")}
          title={fc("DeckMenu")}
          className="grid size-8 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-frame-hover hover:text-ink"
        >
          <AppIcon name="common/ellipsis" size={16} />
        </button>
      </MenuTrigger>

      <MenuContent align="end">
        <MenuItem icon="flyout/rename" onSelect={() => void rename()}>
          {fc("RenameDeck")}
        </MenuItem>

        <MenuSubMenu label={fc("MoveToFolder")} icon="common/folder">
          <MenuItem onSelect={() => void moveToFolder(null)}>{fc("MoveToRoot")}</MenuItem>
          {sortedFolders.map((folder) => (
            <MenuItem key={folder.id} onSelect={() => void moveToFolder(folder.id)}>
              {folder.name}
            </MenuItem>
          ))}
        </MenuSubMenu>

        <MenuItem
          icon="settings-2"
          onSelect={() => useReviewSettings.getState().open(deck.id, deck.name)}
        >
          {fc("ReviewSettingsMenu")}
        </MenuItem>
        <MenuItem
          icon="flyout/export"
          hint=".apkg · .csv · .mnemo"
          onSelect={() =>
            useTransfer.getState().open({
              direction: "export",
              scope: { label: deck.name, deckIds: [deck.id] },
            })
          }
        >
          {fc("Export")}
        </MenuItem>

        <MenuSeparator />
        <MenuItem icon="common/pause" onSelect={() => void suspendAll()}>
          {fc("SuspendAllCards")}
        </MenuItem>
        <MenuItem icon="common/trash" danger onSelect={() => void remove()}>
          {fc("DeleteDeck")}
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
