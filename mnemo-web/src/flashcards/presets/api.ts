import { useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch, apiSend, ApiError } from "@/api/client"
import type { DeckSummaryDto, PresetDto, SavePresetDto } from "@/api/types"

import { deckKey } from "../deck/api"

export const presetsKey = ["flashcards", "presets"] as const

export function usePresetsQuery(enabled: boolean) {
  return useQuery<PresetDto[], ApiError>({
    queryKey: presetsKey,
    queryFn: () => apiFetch<PresetDto[]>("/presets"),
    enabled,
    // The dialog is the only reader and it edits what it shows, so a refetch behind an open
    // dialog would fight the drafts on screen.
    staleTime: Infinity,
  })
}

/**
 * The deck the dialog was opened from, for its current preset. Shares the deck page's cache key
 * so opening this from a deck that is already on screen costs no request.
 */
export function useDeckPresetQuery(deckId: string | null) {
  return useQuery<DeckSummaryDto, ApiError>({
    queryKey: [...deckKey(deckId ?? ""), "summary"],
    queryFn: () => apiFetch<DeckSummaryDto>(`/decks/${deckId}`),
    enabled: deckId !== null,
  })
}

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }
}

export function createPreset(body: SavePresetDto): Promise<PresetDto> {
  return apiFetch<PresetDto>("/presets", json(body))
}

export function updatePreset(presetId: string, body: SavePresetDto): Promise<PresetDto> {
  return apiFetch<PresetDto>(`/presets/${presetId}`, { ...json(body), method: "PUT" })
}

export function deletePreset(presetId: string): Promise<void> {
  return apiSend(`/presets/${presetId}`, { method: "DELETE" })
}

export function assignDeckPreset(deckId: string, presetId: string): Promise<void> {
  return apiSend(`/decks/${deckId}/preset`, json({ presetId }))
}

/**
 * Invalidates everything flashcards after a preset write.
 *
 * A preset is shared, so a saved edit changes the daily limits and ordering of every deck bound
 * to it - which deck rows, due counts and any open session queue are all downstream of. Naming
 * the affected caches would mean knowing which decks those are; the root key is honest instead.
 */
export function useRefreshAfterPresetWrite() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: ["flashcards"] })
}
