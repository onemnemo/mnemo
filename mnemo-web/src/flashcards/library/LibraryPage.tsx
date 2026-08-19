import { useMemo, useRef } from "react"

import { navigate } from "@/app/router"
import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu"
import { Skeleton } from "@/components/ui/skeleton"
import { useT } from "@/i18n/useT"
import { dialog } from "@/stores/dialog"
import { toast } from "@/stores/toast"

import {
  useAggregateDueQuery,
  useApplyLibraryMove,
  useCreateDeck,
  useCreateFolder,
  useDecksQuery,
  useFoldersQuery,
  type LibraryWrites,
} from "../api"
import { DeckGrid } from "./components/DeckGrid"
import { DuePanel } from "./components/DuePanel"
import { LibraryToolbar } from "./components/LibraryToolbar"
import { LibraryTree } from "./components/LibraryTree"
import { DragLayer } from "./dnd/DragLayer"
import type { DragHandle, DropTarget } from "./dnd/model"
import { planDeckMove, planFolderMove } from "./dnd/plan"
import { useLibraryDrag } from "./dnd/useLibraryDrag"
import { useTransfer } from "../transfer/store"
import { useLibraryView } from "./store"
import { buildLibrary, decksInScope, sortDecks } from "./tree"

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
  const layout = useLibraryView((s) => s.layout)
  const collapsed = useLibraryView((s) => s.collapsed)
  const toggleFolder = useLibraryView((s) => s.toggleFolder)
  const toggleAll = useLibraryView((s) => s.toggleAll)

  const model = useMemo(
    () => buildLibrary({ folders: folders.data ?? [], decks: decks.data ?? [], search, sort, collapsed }),
    [folders.data, decks.data, search, sort, collapsed],
  )

  // The grid is flat, so it takes everything the search leaves in scope rather than
  // the rows: a collapsed folder is a list idea and must not hide a card.
  const gridDecks = useMemo(
    () => sortDecks(decksInScope(decks.data ?? [], search), sort),
    [decks.data, search, sort],
  )
  const folderNames = useMemo(
    () => new Map((folders.data ?? []).map((folder) => [folder.id, folder.name])),
    [folders.data],
  )

  const loaded = decks.isSuccess && folders.isSuccess
  const isError = decks.isError || folders.isError
  const deckCount = decks.data?.length ?? 0
  const shownCount = layout === "grid" ? gridDecks.length : model.rows.length
  const showEmpty = loaded && deckCount === 0
  const showNoResults = loaded && deckCount > 0 && shownCount === 0
  const due = aggregateDue.data

  // Study all opens the deck with the most waiting, which is what the sort already
  // put first when it is sorting by due. There is no cross-deck session to start.
  const studyTarget = useMemo(() => {
    const withWork = (decks.data ?? []).filter((deck) => deck.dueCounts.total > 0)
    const pool = withWork.length > 0 ? withWork : (decks.data ?? [])
    return sortDecks(pool, "due")[0] ?? null
  }, [decks.data])

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

  const surfaceRef = useRef<HTMLDivElement>(null)
  const applyMove = useApplyLibraryMove()

  const plan = (handle: DragHandle, target: DropTarget): LibraryWrites | null => {
    // Planned from the orders currently in hand, so while a move is still settling there is
    // nothing to plan against: a second drop would renumber using figures the server has
    // already replaced and undo the one in flight.
    if (applyMove.isPending) return null

    const writes =
      handle.kind === "deck"
        ? planDeckMove(handle.id, target.parentId, decks.data ?? [])
        : planFolderMove(handle.id, target, folders.data ?? [])

    return writes.folders.length === 0 && !writes.deck ? null : writes
  }

  const onDrop = (writes: LibraryWrites) =>
    applyMove.mutate(writes, {
      onError: () =>
        toast.warning(fc("LibraryMoveErrorTitle"), { description: fc("LibraryMoveErrorMessage") }),
    })

  const drag = useLibraryDrag({ surfaceRef, folders: folders.data ?? [], plan, onDrop })

  // Export from here covers what the search leaves in scope, the way the desktop scopes it -
  // deliberately NOT the visible rows, because a collapsed folder hides its decks from the table
  // while they are still very much part of "All decks".
  const openTransfer = () =>
    useTransfer.getState().open({
      direction: "both",
      scope: {
        label: fc("TransferScopeAllDecks"),
        deckIds: decksInScope(decks.data ?? [], search).map((deck) => deck.id),
      },
    })

  return (
    <div className="mx-auto max-w-[980px] px-8 pt-7 pb-20">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{fc("Title")}</h1>
          <p className="mt-0.5 text-[13px] text-ink-2">
            {fc("DeckCountCardCountFormat", {
              0: model.totals.deckCount,
              1: model.totals.cardCount.toLocaleString(),
            })}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            icon={<AppIcon name="table" size={14} />}
            onClick={() => navigate("flashcard-browse")}
          >
            {fc("BrowseTitle")}
          </Button>
          <Button variant="ghost" icon={<AppIcon name="common/download" size={14} />} onClick={openTransfer}>
            {fc("Import")}
          </Button>
          {/* Neutral, not solid: creating a deck is not the reason anyone opens this
              screen, and it should not outrank the study button below it. */}
          <Menu>
            <MenuTrigger asChild>
              <Button variant="outline" icon={<AppIcon name="plus" size={14} strokeWidth={1.9} />}>
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

      {isError ? (
        <div className="mx-auto flex max-w-[360px] flex-col items-center gap-3 py-16 text-center">
          <div className="grid size-14 place-items-center rounded-xl bg-canvas text-ink-icon shadow-[0_0_0_1px_var(--line)]">
            <AppIcon name="triangle-alert" size={22} strokeWidth={1.5} />
          </div>
          <div>
            <h2 className="text-[14px] font-medium text-ink">{fc("LibraryLoadFailedTitle")}</h2>
            <p className="mt-0.5 text-[12.5px] text-ink-3">{fc("LibraryLoadFailedHint")}</p>
          </div>
          <Button
            variant="outline"
            className="mt-1"
            onClick={() => {
              void decks.refetch()
              void folders.refetch()
            }}
          >
            {fc("Retry")}
          </Button>
        </div>
      ) : !loaded ? (
        <div className="mt-6 flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-11 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          {due && !showEmpty ? (
            <DuePanel
              due={due}
              deckCount={(decks.data ?? []).filter((d) => d.dueCounts.total > 0).length}
              onStudy={() => {
                if (studyTarget) navigate("flashcard-session", studyTarget.id, "review", due.total > 0 ? "due" : "all")
              }}
            />
          ) : null}

          {!showEmpty ? <LibraryToolbar onToggleAll={() => toggleAll(folderIds)} /> : null}

          {layout === "grid" ? (
            gridDecks.length > 0 ? (
              <DeckGrid
                decks={gridDecks}
                folderNames={folderNames}
                onOpenDeck={(id) => navigate("flashcard-deck", id)}
              />
            ) : null
          ) : model.rows.length > 0 ? (
            <LibraryTree
              rows={model.rows}
              onOpenDeck={(id) => navigate("flashcard-deck", id)}
              onToggleFolder={toggleFolder}
              drag={drag}
              surfaceRef={surfaceRef}
            />
          ) : null}

          <DragLayer {...drag} />

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
        </>
      )}
    </div>
  )
}
