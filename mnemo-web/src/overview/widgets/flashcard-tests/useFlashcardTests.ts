import { useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { ApiError } from "@/api/client"
import type { DeckSummaryDto } from "@/api/types"
import { useDecksQuery } from "@/flashcards/api"
import { fetchTestSummary, fetchTestTrend } from "@/flashcards/test/api"

import { deckFanOutKey, deckFanOutRoot } from "../../api"
import { latestTestedDeck, roundAwayFromZero, scoreMovement, type ScoreTrend } from "./tests"

/** How many past attempts the line is drawn through. */
const TREND_ATTEMPTS = 10

const FAN_OUT = "tests"

export interface FlashcardTestsData {
  state: "loading" | "error" | "empty" | "ready"
  deckName: string
  latestPercent: number
  bestPercent: number
  trend: ScoreTrend
  deltaPercent: number
  /** The deck's recent scores, 0 to 100, oldest first. */
  scores: number[]
  retry: () => void
}

interface TestsResult {
  deckName: string
  latestPercent: number
  bestPercent: number
  trend: ScoreTrend
  deltaPercent: number
  scores: number[]
}

/**
 * Asks every deck for its test history, then draws the line for whichever was tested most
 * recently.
 *
 * The fan-out and the follow-up live in one query rather than two chained ones: the second call
 * needs an answer the first produces, and a widget with a single score to show should not have a
 * second loading state in the middle of it.
 */
async function loadTests(decks: readonly DeckSummaryDto[]): Promise<TestsResult | null> {
  const summaries = await Promise.all(
    decks.map(async (deck) => ({
      deckId: deck.id,
      name: deck.name,
      summary: await fetchTestSummary(deck.id),
    })),
  )

  const deck = latestTestedDeck(summaries)
  if (deck === null) return null

  const attempts = await fetchTestTrend(deck.deckId, TREND_ATTEMPTS)
  const movement = scoreMovement(deck.summary.deltaVsPrevious)

  return {
    deckName: deck.name,
    latestPercent: roundAwayFromZero(deck.summary.latestScorePct),
    bestPercent: roundAwayFromZero(deck.summary.bestScorePct),
    trend: movement.trend,
    deltaPercent: movement.deltaPercent,
    scores: attempts.map((attempt) => attempt.scorePct),
  }
}

/** The most recently tested deck's score, isolated from retention and effort counters. */
export function useFlashcardTests(): FlashcardTestsData {
  const decks = useDecksQuery()
  const deckList = decks.data

  const tests = useQuery<TestsResult | null, ApiError>({
    queryKey: deckFanOutKey(FAN_OUT, (deckList ?? []).map((deck) => deck.id)),
    queryFn: () => loadTests(deckList ?? []),
    enabled: deckList !== undefined,
  })

  const client = useQueryClient()
  const refetchDecks = decks.refetch
  // Invalidated by prefix, so a retry does not have to reconstruct the deck-id half of the key.
  const retry = useCallback(() => {
    void client.invalidateQueries({ queryKey: deckFanOutRoot(FAN_OUT) })
    void refetchDecks()
  }, [client, refetchDecks])

  const state = decks.isError || tests.isError
    ? "error"
    : deckList === undefined || tests.isPending
      ? "loading"
      : tests.data === null
        ? "empty"
        : "ready"

  return {
    state,
    deckName: tests.data?.deckName ?? "",
    latestPercent: tests.data?.latestPercent ?? 0,
    bestPercent: tests.data?.bestPercent ?? 0,
    trend: tests.data?.trend ?? "none",
    deltaPercent: tests.data?.deltaPercent ?? 0,
    scores: tests.data?.scores ?? [],
    retry,
  }
}
