import { useEffect, useMemo, useState } from "react"

import { navigate } from "@/app/router"
import { AppIcon } from "@/components/icon/AppIcon"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { useT } from "@/i18n/useT"
import { dialog } from "@/stores/dialog"

import { useDecksQuery, useFoldersQuery } from "../api"
import { deckOptions as buildDeckOptions } from "../editor/deck-options"
import { useCardEditor } from "../editor/store"
import { useCardTypesQuery } from "../facts/api"
import { PAGE_SIZE, SEARCH_DEBOUNCE_MS } from "../deck/cards"
import { lapsesBounds } from "../deck/filters"
import { SelectionBar } from "../deck/components/SelectionBar"
import {
  useBrowseCardsQuery,
  useBrowseDeleteCards,
  useBrowseFlagCards,
  useBrowseMoveCards,
  useBrowseSuspendCards,
  useBrowseTagCards,
  useBrowseTagsQuery,
} from "./api"
import { BrowseTable } from "./components/BrowseTable"
import { BrowseToolbar } from "./components/BrowseToolbar"
import { CardPeek } from "./components/CardPeek"
import { useBrowseView } from "./store"

/**
 * The collection-wide card browser: every deck's cards in one table, filtered and searched the
 * same way one deck's table is. Generalizes deck/DeckPage.tsx; see that file for the shared
 * shape (debounced search, batch actions clearing the selection, the missing-deck redirect has
 * no counterpart here since there is no one deck that can go missing from under the page).
 */
export function BrowsePage() {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

  const search = useBrowseView((s) => s.search)
  const commitSearch = useBrowseView((s) => s.commitSearch)
  const query = useBrowseView((s) => s.query)
  const stateFilter = useBrowseView((s) => s.stateFilter)
  const tagFilter = useBrowseView((s) => s.tagFilter)
  const deckFilter = useBrowseView((s) => s.deckFilter)
  const cardTypeFilter = useBrowseView((s) => s.cardTypeFilter)
  const lapsesFilter = useBrowseView((s) => s.lapsesFilter)
  const sortDescending = useBrowseView((s) => s.sortDescending)
  const offset = useBrowseView((s) => s.offset)
  const selected = useBrowseView((s) => s.selected)
  const clearSelection = useBrowseView((s) => s.clearSelection)
  const openEdit = useCardEditor((s) => s.openEdit)

  const [peekId, setPeekId] = useState<string | null>(null)

  // Debounced so a fast typist issues one request, not one per keystroke.
  useEffect(() => {
    const timer = setTimeout(commitSearch, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search, commitSearch])

  const decks = useDecksQuery()
  const folders = useFoldersQuery()
  const tags = useBrowseTagsQuery()
  const cardTypeSummaries = useCardTypesQuery()
  const lapses = lapsesBounds(lapsesFilter)
  const cards = useBrowseCardsQuery({
    text: query,
    state: stateFilter,
    tag: tagFilter,
    deckId: deckFilter,
    cardTypeId: cardTypeFilter,
    minLapses: lapses.min,
    maxLapses: lapses.max,
    sort: "due",
    sortDescending,
    offset,
    limit: PAGE_SIZE,
  })

  const deleteCards = useBrowseDeleteCards()
  const moveCards = useBrowseMoveCards()
  const suspendCards = useBrowseSuspendCards()
  const flagCards = useBrowseFlagCards()
  const tagCards = useBrowseTagCards()

  const decksById = useMemo(() => new Map((decks.data ?? []).map((deck) => [deck.id, deck])), [decks.data])
  const moveTargets = useMemo(
    () => [...(decks.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [decks.data],
  )
  const deckOptionList = useMemo(
    () => buildDeckOptions(decks.data ?? [], folders.data ?? []),
    [decks.data, folders.data],
  )
  const cardTypeList = useMemo(() => (cardTypeSummaries.data ?? []).map((summary) => summary.type), [cardTypeSummaries.data])

  const now = Date.now()
  const page = cards.data

  const selectedViews = useMemo(
    () => (page?.items ?? []).filter((item) => selected.has(item.card.id)),
    [page, selected],
  )
  const selectedIds = selectedViews.map((item) => item.card.id)
  const peekView = peekId ? (page?.items ?? []).find((item) => item.card.id === peekId) ?? null : null

  const run = async (action: Promise<unknown>) => {
    await action
    clearSelection()
  }

  const confirmDelete = async (ids: string[]) => {
    const ok = await dialog.confirm({
      title: fc("DeleteCard"),
      message: ids.length === 1 ? fc("DeleteCardConfirm") : fc("DeleteCardsConfirmFormat", { 0: ids.length }),
      destructive: true,
      confirmLabel: t("Common", "Delete"),
      cancelLabel: t("Common", "Cancel"),
    })
    if (ok) await run(deleteCards.mutateAsync(ids))
  }

  const filtered =
    stateFilter !== "all" ||
    tagFilter !== null ||
    deckFilter !== null ||
    cardTypeFilter !== null ||
    lapsesFilter !== "any" ||
    query.trim().length > 0
  const hasRows = (page?.items.length ?? 0) > 0
  const loaded = cards.isSuccess
  const showEmpty = loaded && !hasRows && !filtered
  const showNoResults = loaded && !hasRows && filtered

  return (
    <div className="relative flex h-full flex-col">
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1080px] px-8 pt-6 pb-20">
          <button
            type="button"
            onClick={() => navigate("flashcards")}
            className="-ml-1.5 flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[12.5px] text-ink-3 transition-colors hover:bg-frame-hover hover:text-ink"
          >
            <AppIcon name="arrow-left" size={14} strokeWidth={1.8} />
            {fc("BackToLibrary")}
          </button>

          <header className="mt-2">
            <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{fc("BrowseTitle")}</h1>
            <p className="mt-0.5 text-[12.5px] text-ink-2">
              {fc("DeckCardCountFormat", { 0: (page?.totalCount ?? 0).toLocaleString() })}
            </p>
          </header>

          {!showEmpty ? (
            <BrowseToolbar knownTags={tags.data ?? []} deckOptions={deckOptionList} cardTypes={cardTypeList} />
          ) : null}

          {!loaded ? (
            <div className="mt-6 flex flex-col gap-2">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-11 w-full rounded-lg" />
              ))}
            </div>
          ) : null}

          {hasRows && page ? (
            <BrowseTable
              page={page}
              decksById={decksById}
              moveTargets={moveTargets}
              now={now}
              actions={{
                onPeek: (cardId) => setPeekId(cardId),
                onEdit: (cardId) => {
                  const deckId = page.items.find((item) => item.card.id === cardId)?.card.deckId
                  if (deckId) openEdit(deckId, cardId)
                },
                onFlag: (cardId, value) => void run(flagCards.mutateAsync({ cardIds: [cardId], value })),
                onSuspend: (cardId, value) => void run(suspendCards.mutateAsync({ cardIds: [cardId], value })),
                onMove: (cardId, targetDeckId) =>
                  void run(moveCards.mutateAsync({ cardIds: [cardId], targetDeckId })),
                onDelete: (cardId) => void confirmDelete([cardId]),
              }}
            />
          ) : null}

          {showEmpty ? (
            <EmptyState
              className="mt-12"
              icon="common/book"
              title={fc("LibraryEmptyTitle")}
              description={fc("BrowseEmptyDescription")}
            />
          ) : null}

          {showNoResults ? (
            <EmptyState
              className="mt-12"
              icon="common/search"
              title={fc("NoResultsTitle")}
              description={fc("DeckNoResultsDescription")}
            />
          ) : null}
        </div>
      </div>

      {peekView ? (
        <CardPeek
          view={peekView}
          deckName={decksById.get(peekView.card.deckId)?.name ?? peekView.card.deckId}
          onClose={() => setPeekId(null)}
          onEdit={() => {
            setPeekId(null)
            openEdit(peekView.card.deckId, peekView.card.id)
          }}
        />
      ) : null}

      {selectedIds.length > 0 ? (
        <SelectionBar
          count={selectedIds.length}
          allSuspended={selectedViews.every((item) => item.card.state === "suspended")}
          allFlagged={selectedViews.every((item) => item.card.isFlagged)}
          moveTargets={moveTargets}
          onMove={(targetDeckId) => void run(moveCards.mutateAsync({ cardIds: selectedIds, targetDeckId }))}
          onTag={(tag) => void run(tagCards.mutateAsync({ cardIds: selectedIds, tag }))}
          onSuspend={(value) => void run(suspendCards.mutateAsync({ cardIds: selectedIds, value }))}
          onFlag={(value) => void run(flagCards.mutateAsync({ cardIds: selectedIds, value }))}
          onDelete={() => void confirmDelete(selectedIds)}
          onClear={clearSelection}
        />
      ) : null}
    </div>
  )
}
