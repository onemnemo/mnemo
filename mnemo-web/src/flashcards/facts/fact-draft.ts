import type { CardTypeDto, FactDto, SaveFactDto } from "@/api/types"

import { draftFromStored, type DraftAttachment } from "../editor/draft"
import { generate, type FactLike } from "./generation"

/**
 * Material as the editor holds it: a value and a set of attachments per field of the card type.
 *
 * Attachments are keyed by field rather than by card side, which is what lets one picture follow
 * the field it belongs to onto whichever side of whichever card shows it. The `side` a
 * {@link DraftAttachment} still carries is a placeholder the server rewrites per card.
 */
export interface FactDraft {
  deckId: string
  typeId: string
  values: Record<string, string>
  media: Record<string, DraftAttachment[]>
  tags: string[]
}

const PLACEHOLDER_SIDE = "front" as const

export function emptyDraft(deckId: string, typeId: string): FactDraft {
  return { deckId, typeId, values: {}, media: {}, tags: [] }
}

export function draftFromFact(fact: FactDto): FactDraft {
  const media: Record<string, DraftAttachment[]> = {}
  for (const field of fact.media) {
    media[field.fieldId] = field.attachments.map(draftFromStored)
  }

  return {
    deckId: fact.deckId,
    typeId: fact.typeId,
    values: { ...fact.values },
    media,
    tags: [...fact.tags],
  }
}

/**
 * The deck an edit should file its material under.
 *
 * Material goes on naming the deck it was written in after a card it made has been moved to another
 * one, so that name can outlive the deck itself and reach the editor pointing at a deck the
 * collection no longer has. The deck the card being edited is filed in is the one to fall back to,
 * which is what the desktop editor has always started from.
 *
 * No decks at all means they have not loaded yet, which is not the same as the named one being gone.
 */
export function resolveDraftDeck(deckId: string, deckIds: readonly string[], cardDeckId: string): string {
  return deckIds.length === 0 || deckIds.includes(deckId) ? deckId : cardDeckId
}

/** The view the generator wants, still holding the attachments this edit has not saved yet. */
export function asFactLike(draft: FactDraft): FactLike<DraftAttachment> {
  return { values: draft.values, media: draft.media }
}

function hasSomething(text: string, attachments: DraftAttachment[]): boolean {
  return text.trim().length > 0 || attachments.length > 0
}

/**
 * Whether a save is worth making.
 *
 * The server refuses material that would make no cards at all, since a fact with no cards is
 * unreachable afterwards. The editor holds out for a bit more than that: a card blank on one side
 * is not a card either, and an ordinary layout fires whether or not anything was typed into it, so
 * without this an empty form would look saveable.
 */
export function canSaveFact(type: CardTypeDto | undefined, draft: FactDraft): boolean {
  if (!type || !draft.deckId) return false
  return generate(type, asFactLike(draft)).some(
    (card) => hasSomething(card.front, card.frontMedia) && hasSomething(card.back, card.backMedia),
  )
}

export function toSaveFact(id: string | null, draft: FactDraft): SaveFactDto {
  return {
    id,
    deckId: draft.deckId,
    typeId: draft.typeId,
    values: draft.values,
    media: Object.entries(draft.media)
      .filter(([, attachments]) => attachments.length > 0)
      .map(([fieldId, attachments]) => ({
        fieldId,
        attachments: attachments.map((attachment) => ({
          id: attachment.id,
          assetId: attachment.assetId,
          side: PLACEHOLDER_SIDE,
          displayName: attachment.displayName,
          caption: attachment.caption,
        })),
      })),
    tags: draft.tags,
  }
}

/**
 * The part of the draft that decides whether closing would lose work. The deck and the card type
 * are deliberately left out: changing either before typing anything is not worth a warning.
 */
export interface FactDraftSnapshot {
  values: string
  media: string
  tags: string
}

export function snapshotFactDraft(draft: FactDraft): FactDraftSnapshot {
  const values = Object.entries(draft.values)
    .filter(([, value]) => value.length > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const media = Object.entries(draft.media)
    .map(([fieldId, attachments]) => [fieldId, attachments.map((attachment) => attachment.key)] as const)
    .filter(([, keys]) => keys.length > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

  return {
    values: JSON.stringify(values),
    media: JSON.stringify(media),
    tags: JSON.stringify(draft.tags),
  }
}

export function factDraftIsDirty(baseline: FactDraftSnapshot, current: FactDraftSnapshot): boolean {
  return (
    baseline.values !== current.values || baseline.media !== current.media || baseline.tags !== current.tags
  )
}
