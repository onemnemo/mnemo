import { useCallback, useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { useDecksQuery } from "@/flashcards/api"
import { useT } from "@/i18n/useT"
import { useNotesQuery } from "@/notes/api"

import { statRecordsKey, useStatRecords } from "../../api"
import { buildRecentRows, type RecentRow } from "./rows"

const NS = "flashcards"
const DECK_SUMMARY = "deck.summary"

/** How many deck records to consider. A user with more decks than this loses the quietest ones. */
const RECORD_CEILING = 64

export interface RecentData {
  state: "loading" | "error" | "empty" | "ready"
  rows: RecentRow[]
  retry: () => void
}

/**
 * The last things touched, notes and decks together.
 *
 * Three reads that have to be joined: the notes list, the per-deck statistics record that says
 * when a deck was last practised, and the deck list that says it still exists. All three come from
 * queries the rest of the app already owns, so a reader who has just come from Notes or the
 * library pays for no second fetch.
 */
export function useRecent(limit: number): RecentData {
  const t = useT()
  const notes = useNotesQuery()
  const decks = useDecksQuery()
  const records = useStatRecords(NS, DECK_SUMMARY, RECORD_CEILING, true)

  const client = useQueryClient()
  const refetchNotes = notes.refetch
  const refetchDecks = decks.refetch
  const retry = useCallback(() => {
    void refetchNotes()
    void refetchDecks()
    void client.invalidateQueries({ queryKey: statRecordsKey(NS, DECK_SUMMARY, RECORD_CEILING, true) })
  }, [client, refetchNotes, refetchDecks])

  const noteList = notes.data
  const deckList = decks.data
  const recordList = records.data

  const rows = useMemo(
    () =>
      noteList === undefined || deckList === undefined || recordList === undefined
        ? []
        : buildRecentRows(noteList, recordList, deckList, { limit, untitled: t("WidgetRecent", "Untitled") }),
    [noteList, deckList, recordList, limit, t],
  )

  const state = notes.isError || decks.isError || records.isError
    ? "error"
    : notes.isPending || decks.isPending || records.isPending
      ? "loading"
      : rows.length === 0
        ? "empty"
        : "ready"

  return { state, rows, retry }
}
