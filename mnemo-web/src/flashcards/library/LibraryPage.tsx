import { useMemo } from "react"

import { navigate } from "@/app/router"
import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu"
import { useT } from "@/i18n/useT"
import { dialog } from "@/stores/dialog"

import { useAggregateDueQuery, useCreateDeck, useCreateFolder, useDecksQuery, useFoldersQuery } from "../api"
import { DueBanner } from "./components/DueBanner"
import { LibraryToolbar } from "./components/LibraryToolbar"
import { LibraryTree } from "./components/LibraryTree"
import { useLibraryView } from "./store"
import { buildLibrary } from "./tree"

export function LibraryPage() {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

  const decks = useDecksQuery()
  const folders = useFoldersQuery()
  const aggregateDue = useAggregateDueQuery()
  const createDeck = useCreateDeck()
  const createFolder = useCreateFolder()

  const search = useLibraryView((s) => s.search)
  const sort = useLibraryView((s) => s.sort)
  const collapsed = useLibraryView((s) => s.collapsed)
  const toggleFolder = useLibraryView((s) => s.toggleFolder)
  const toggleAll = useLibraryView((s) => s.toggleAll)

  const model = useMemo(
    () => buildLibrary({ folders: folders.data ?? [], decks: decks.data ?? [], search, sort, collapsed }),
    [folders.data, decks.data, search, sort, collapsed],
  )

  const loaded = decks.isSuccess && folders.isSuccess
  const deckCount = decks.data?.length ?? 0
  const showEmpty = loaded && deckCount === 0
  const showNoResults = loaded && deckCount > 0 && model.rows.length === 0
  const due = aggregateDue.data

  const onCreateDeck = async () => {
    const value = await dialog.prompt({
      title: fc("NewDeck"),
      defaultValue: fc("DefaultDeckName"),
      placeholder: fc("DeckNamePlaceholder"),
      confirmLabel: t("Common", "Create"),
      cancelLabel: t("Common", "Cancel"),
    })
    const name = value?.trim()
    if (!name) return
    const deck = await createDeck.mutateAsync({ name, folderId: null, presetId: null })
    if (deck && typeof deck === "object" && "id" in deck) navigate("flashcard-deck", String(deck.id))
  }

  // No prompt, matching the desktop: the folder lands named "New folder" and is
  // renamed inline from the row.
  const onCreateFolder = async () => {
    const rootOrder = Math.max(-1, ...(folders.data ?? []).filter((f) => f.parentId === null).map((f) => f.order)) + 1
    await createFolder.mutateAsync({ name: fc("NewFolderName"), parentId: null, order: rootOrder })
  }

  const folderIds = useMemo(() => (folders.data ?? []).map((f) => f.id), [folders.data])

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-4 px-10 pt-[26px] pb-8">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-[3px]">
          <h1 className="text-heading-4 font-semibold text-text-primary">{fc("Title")}</h1>
          <p className="text-body-extra-small text-text-tertiary">
            {fc("DeckCountCardCountFormat", {
              0: model.totals.deckCount,
              1: model.totals.cardCount.toLocaleString(),
            })}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Import lands with the transfer work later this phase. */}
          <Button variant="outline" size="sm" disabled>
            <AppIcon name="common/download" size={14} />
            {fc("Import")}
          </Button>
          <Menu>
            <MenuTrigger asChild>
              <Button size="sm">
                <AppIcon name="common/plus" size={16} />
                {fc("NewButton")}
              </Button>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem icon="common/file-text" onSelect={() => void onCreateDeck()}>
                {fc("NewMenuDeck")}
              </MenuItem>
              <MenuItem icon="common/folder" onSelect={() => void onCreateFolder()}>
                {fc("NewMenuFolder")}
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </header>

      {due && due.total > 0 ? (
        <DueBanner due={due} deckCount={(decks.data ?? []).filter((d) => d.dueCounts.total > 0).length} />
      ) : null}

      {!showEmpty ? <LibraryToolbar onToggleAll={() => toggleAll(folderIds)} /> : null}

      {model.rows.length > 0 ? (
        <LibraryTree
          rows={model.rows}
          totals={model.totals}
          onOpenDeck={(id) => navigate("flashcard-deck", id)}
          onToggleFolder={toggleFolder}
        />
      ) : null}

      {showEmpty ? (
        <EmptyState
          className="mt-12"
          icon="common/book"
          title={fc("LibraryEmptyTitle")}
          description={fc("LibraryEmptyDescription")}
          action={
            <Button size="sm" onClick={() => void onCreateDeck()}>
              {fc("NewDeck")}
            </Button>
          }
        />
      ) : null}

      {showNoResults ? (
        <EmptyState
          className="mt-12"
          icon="common/search"
          title={fc("NoResultsTitle")}
          description={fc("NoResultsDescription")}
        />
      ) : null}
    </div>
  )
}
