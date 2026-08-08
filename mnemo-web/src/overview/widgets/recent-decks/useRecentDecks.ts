import { useCallback, useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"

import type { WidgetInstanceDto } from "@/api/types"
import { useDecksQuery } from "@/flashcards/api"
import { useI18nStore } from "@/i18n/store"
import { useT } from "@/i18n/useT"
import { formatSmart } from "@/lib/relative-date"

import { statRecordsKey, useStatRecords } from "../../api"
import { settingInt, settingString } from "../../config/encode"
import type { WidgetManifest } from "../manifest"
import { buildRecentDeckRows, type RecentDeckRow } from "./rows"

const NS = "flashcards"
const DECK_SUMMARY = "deck.summary"

/**
 * How many deck records to consider. The desktop's ceiling, kept so the two apps look at the same
 * set of rows: a user with more decks than this sees the same ones dropped in both.
 */
const RECORD_CEILING = 64

export interface RecentDecksData {
  state: "loading" | "error" | "empty" | "ready"
  rows: RecentDeckRow[]
  retry: () => void
}

/**
 * The decks practiced inside a rolling window, as configured on the instance.
 *
 * Two reads that have to be joined: the per-deck statistics record carries when the deck was last
 * practiced and how much of it, and the deck list carries everything the row displays. Neither is
 * enough on its own, and the record outlives the deck, so the join is also what keeps a deleted
 * deck off the board.
 */
export function useRecentDecks(instance: WidgetInstanceDto, manifest: WidgetManifest): RecentDecksData {
  const t = useT()
  const language = useI18nStore((state) => state.language)

  const records = useStatRecords(NS, DECK_SUMMARY, RECORD_CEILING, true)
  const decks = useDecksQuery()

  const days = settingInt(manifest, instance.settings, "days_to_show")
  const limit = settingInt(manifest, instance.settings, "limit")
  const sortBy = settingString(manifest, instance.settings, "sort_by")

  const client = useQueryClient()
  const refetchDecks = decks.refetch
  const retry = useCallback(() => {
    void client.invalidateQueries({ queryKey: statRecordsKey(NS, DECK_SUMMARY, RECORD_CEILING, true) })
    void refetchDecks()
  }, [client, refetchDecks])

  const recordList = records.data
  const deckList = decks.data

  const rows = useMemo(
    () =>
      recordList === undefined || deckList === undefined
        ? []
        : buildRecentDeckRows(recordList, deckList, {
            days,
            limit,
            sortBy,
            // Read once per rebuild rather than per row, so every row in one render measures its
            // window and its wording against the same instant.
            now: Date.now(),
            formatDate: (timestamp, now) => formatSmart(new Date(timestamp), now, t, language),
            // From the board's namespace, not the widget's: it is the same word on every widget
            // that counts cards, and the desktop looks it up there too.
            cards: t("Overview", "cards"),
          }),
    [recordList, deckList, days, limit, sortBy, t, language],
  )

  const state = records.isError || decks.isError
    ? "error"
    : records.isPending || decks.isPending
      ? "loading"
      : rows.length === 0
        ? "empty"
        : "ready"

  return { state, rows, retry }
}
