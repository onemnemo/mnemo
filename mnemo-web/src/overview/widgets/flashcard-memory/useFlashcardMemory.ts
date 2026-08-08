import { useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { ApiError } from "@/api/client"
import type { DeckSummaryDto } from "@/api/types"
import { fetchRetentionTrend, useDecksQuery } from "@/flashcards/api"

import { deckFanOutKey, deckFanOutRoot } from "../../api"
import { weightedRetention, type DeckRetention } from "./memory"

/** The window the retention figure and the weights are measured over. */
const RETENTION_DAYS = 30

/** The shorter window the sparkline draws, so a month's worth of dots does not become a smear. */
const TREND_DAYS = 14

const FAN_OUT = "retention"

export interface FlashcardMemoryData {
  state: "loading" | "error" | "empty" | "ready"
  retentionPercent: number
  /** The busiest deck's recent retention, 0 to 100, oldest first. */
  trend: number[]
  trendDeckName: string
  retry: () => void
}

interface MemoryResult {
  retentionPercent: number
  trend: number[]
  trendDeckName: string
}

/**
 * Loads every deck's review volume, then the trend line for whichever deck was busiest.
 *
 * One fan-out and one follow-up inside a single query rather than two chained ones. The follow-up
 * depends on an answer the fan-out produces, and splitting them would put a second loading state
 * in the middle of a widget that has one number to show.
 */
async function loadMemory(decks: readonly DeckSummaryDto[]): Promise<MemoryResult | null> {
  const volumes = await Promise.all(
    // Retention itself is not fetched: the deck list already carries it over the same 30-day
    // window, computed from the same review sample. Only the volume needs the trend call.
    decks.map(async (deck): Promise<DeckRetention> => {
      const trend = await fetchRetentionTrend(deck.id, RETENTION_DAYS)
      return {
        deckId: deck.id,
        name: deck.name,
        retentionPercent: deck.retentionPercent,
        volume: trend.reduce((total, point) => total + point.reviewsCount, 0),
      }
    }),
  )

  const weighted = weightedRetention(volumes)
  if (weighted === null) return null

  const trend = await fetchRetentionTrend(weighted.busiest.deckId, TREND_DAYS)

  return {
    retentionPercent: weighted.retentionPercent,
    trend: trend.map((point) => point.retentionPercent),
    trendDeckName: weighted.busiest.name,
  }
}

/** True retention across the library, weighted by how much of each deck was actually reviewed. */
export function useFlashcardMemory(): FlashcardMemoryData {
  const decks = useDecksQuery()
  const deckList = decks.data
  const memory = useQuery<MemoryResult | null, ApiError>({
    queryKey: deckFanOutKey(FAN_OUT, (deckList ?? []).map((deck) => deck.id)),
    queryFn: () => loadMemory(deckList ?? []),
    enabled: deckList !== undefined,
  })

  const client = useQueryClient()
  const refetchDecks = decks.refetch
  // Invalidated by prefix, so a retry does not have to reconstruct the deck-id half of the key.
  const retry = useCallback(() => {
    void client.invalidateQueries({ queryKey: deckFanOutRoot(FAN_OUT) })
    void refetchDecks()
  }, [client, refetchDecks])

  const state = decks.isError || memory.isError
    ? "error"
    : deckList === undefined || memory.isPending
      ? "loading"
      : memory.data === null
        ? "empty"
        : "ready"

  return {
    state,
    retentionPercent: memory.data?.retentionPercent ?? 0,
    trend: memory.data?.trend ?? [],
    trendDeckName: memory.data?.trendDeckName ?? "",
    retry,
  }
}
