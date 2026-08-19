import { useEffect, useMemo } from "react"

import { navigate } from "@/app/router"
import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { useT } from "@/i18n/useT"
import { dialog } from "@/stores/dialog"

import { useDecksQuery } from "../api"
import { useCardEditor } from "../editor/store"
import {
  useCardTagsQuery,
  useCardsQuery,
  useDeckQuery,
  useDeleteCards,
  useFlagCards,
  useMoveCards,
  useSuspendCards,
  useTagCards,
} from "./api"
import { PAGE_SIZE, SEARCH_DEBOUNCE_MS } from "./cards"
import { lapsesBounds } from "./filters"
import { CardTable } from "./components/CardTable"
import { DeckHeader } from "./components/DeckHeader"
import { DeckToolbar } from "./components/DeckToolbar"
import { SelectionBar } from "./components/SelectionBar"
import { useDeckView } from "./store"

export function DeckPage({ deckId }: { deckId?: string }) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

  const openDeck = useDeckView((s) => s.openDeck)
  const search = useDeckView((s) => s.search)
  const commitSearch = useDeckView((s) => s.commitSearch)
  const query = useDeckView((s) => s.query)
  const stateFilter = useDeckView((s) => s.stateFilter)
  const tagFilter = useDeckView((s) => s.tagFilter)
  const typeFilter = useDeckView((s) => s.typeFilter)
  const lapsesFilter = useDeckView((s) => s.lapsesFilter)
  const sortDescending = useDeckView((s) => s.sortDescending)
  const offset = useDeckView((s) => s.offset)
  const selected = useDeckView((s) => s.selected)
  const clearSelection = useDeckView((s) => s.clearSelection)
  const openAdd = useCardEditor((s) => s.openAdd)
  const openEdit = useCardEditor((s) => s.openEdit)

  useEffect(() => {
    if (deckId) openDeck(deckId)
  }, [deckId, openDeck])

  // Debounced so a fast typist issues one request, not one per keystroke.
  useEffect(() => {
    const timer = setTimeout(commitSearch, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search, commitSearch])

  const id = deckId ?? ""
  const deck = useDeckQuery(id)
  const decks = useDecksQuery()
  const tags = useCardTagsQuery(id)
  const lapses = lapsesBounds(lapsesFilter)
  const cards = useCardsQuery(id, {
    text: query,
    state: stateFilter,
    tag: tagFilter,
    type: typeFilter,
    minLapses: lapses.min,
    maxLapses: lapses.max,
    sort: "due",
    sortDescending,
    offset,
    limit: PAGE_SIZE,
  })

  const deleteCards = useDeleteCards(id)
  const moveCards = useMoveCards(id)
  const suspendCards = useSuspendCards(id)
  const flagCards = useFlagCards(id)
  const tagCards = useTagCards(id)

  // A deck that has been deleted (in another window, or by this page's own menu)
  // sends you back to the library rather than showing an error.
  const missing = !deckId || deck.error?.status === 404
  useEffect(() => {
    if (missing) navigate("flashcards")
  }, [missing])

  const page = cards.data
  const moveTargets = useMemo(
    () => (decks.data ?? []).filter((d) => d.id !== id).sort((a, b) => a.name.localeCompare(b.name)),
    [decks.data, id],
  )

  // Due labels are day-granularity, so reading the clock per render is stable enough.
  const now = Date.now()

  const selectedViews = useMemo(
    () => (page?.items ?? []).filter((item) => selected.has(item.card.id)),
    [page, selected],
  )
  const selectedIds = selectedViews.map((item) => item.card.id)

  // A context menu action on a single unselected row must not disturb an
  // unrelated multi-selection sitting elsewhere on the page, so the selection
  // only clears when the ids the action just touched were part of it.
  const run = async (ids: string[], action: Promise<unknown>) => {
    await action
    if (ids.some((cardId) => selected.has(cardId))) clearSelection()
  }

  const confirmDelete = async (ids: string[]) => {
    const ok = await dialog.confirm({
      title: fc("DeleteCard"),
      message: ids.length === 1 ? fc("DeleteCardConfirm") : fc("DeleteCardsConfirmFormat", { 0: ids.length }),
      destructive: true,
      confirmLabel: t("Common", "Delete"),
      cancelLabel: t("Common", "Cancel"),
    })
    if (ok) await run(ids, deleteCards.mutateAsync(ids))
  }

  if (missing) return null

  const filtered =
    stateFilter !== "all" ||
    tagFilter !== null ||
    typeFilter !== null ||
    lapsesFilter !== "any" ||
    query.trim().length > 0
  const hasRows = (page?.items.length ?? 0) > 0
  const loaded = cards.isSuccess
  const showEmpty = loaded && !hasRows && !filtered
  const showNoResults = loaded && !hasRows && filtered

  return (
    // The page owns its scrolling rather than the shell, so the selection bar can
    // sit against the bottom of the window instead of the bottom of the table.
    <div className="relative flex h-full flex-col">
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1080px] px-8 pt-6 pb-20">
          <button
            type="button"
            onClick={() => navigate("flashcards")}
            className="-ml-1.5 flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[12.5px] text-ink-3 transition-colors hover:bg-frame-hover hover:text-ink"
          >
            <AppIcon name="arrow-left" size={14} strokeWidth={1.8} />
            {fc("AllDecks")}
          </button>

          {deck.isError ? (
            <div className="mx-auto flex max-w-[360px] flex-col items-center gap-3 py-16 text-center">
              <div className="grid size-14 place-items-center rounded-xl bg-canvas text-ink-icon shadow-[0_0_0_1px_var(--line)]">
                <AppIcon name="triangle-alert" size={22} strokeWidth={1.5} />
              </div>
              <div>
                <h2 className="text-[14px] font-medium text-ink">{fc("DeckLoadFailedTitle")}</h2>
                <p className="mt-0.5 text-[12.5px] text-ink-3">{fc("DeckLoadFailedHint")}</p>
              </div>
              <Button variant="outline" className="mt-1" onClick={() => void deck.refetch()}>
                {fc("Retry")}
              </Button>
            </div>
          ) : !deck.data ? (
            <div className="mt-6 flex flex-col gap-2">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-11 w-full rounded-lg" />
              ))}
            </div>
          ) : (
            <>
              <DeckHeader deck={deck.data} />

              {!showEmpty ? <DeckToolbar knownTags={tags.data ?? []} /> : null}

              {hasRows && page ? (
                <CardTable
                  page={page}
                  deckTotal={deck.data.totalCards}
                  moveTargets={moveTargets}
                  now={now}
                  actions={{
                    onEdit: (cardId) => openEdit(id, cardId),
                    onFlag: (cardId, value) => void run([cardId], flagCards.mutateAsync({ cardIds: [cardId], value })),
                    onSuspend: (cardId, value) =>
                      void run([cardId], suspendCards.mutateAsync({ cardIds: [cardId], value })),
                    onMove: (cardId, targetDeckId) =>
                      void run([cardId], moveCards.mutateAsync({ cardIds: [cardId], targetDeckId })),
                    onDelete: (cardId) => void confirmDelete([cardId]),
                  }}
                />
              ) : null}

              {showEmpty ? (
                <EmptyState
                  className="mt-12"
                  icon="common/book"
                  title={fc("DeckEmptyTitle")}
                  description={fc("DeckEmptyDescription")}
                  action={
                    <Button size="sm" onClick={() => openAdd(id)}>
                      {fc("DeckAddCards")}
                    </Button>
                  }
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
            </>
          )}
        </div>
      </div>

      {selectedIds.length > 0 ? (
        <SelectionBar
          count={selectedIds.length}
          allSuspended={selectedViews.every((item) => item.card.state === "suspended")}
          allFlagged={selectedViews.every((item) => item.card.isFlagged)}
          moveTargets={moveTargets}
          onMove={(targetDeckId) =>
            void run(selectedIds, moveCards.mutateAsync({ cardIds: selectedIds, targetDeckId }))
          }
          onTag={(tag) => void run(selectedIds, tagCards.mutateAsync({ cardIds: selectedIds, tag }))}
          onSuspend={(value) => void run(selectedIds, suspendCards.mutateAsync({ cardIds: selectedIds, value }))}
          onFlag={(value) => void run(selectedIds, flagCards.mutateAsync({ cardIds: selectedIds, value }))}
          onDelete={() => void confirmDelete(selectedIds)}
          onClear={clearSelection}
        />
      ) : null}
    </div>
  )
}
