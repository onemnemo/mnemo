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

function fieldKey(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * Moves a draft onto another card type, carrying what it holds.
 *
 * Field ids belong to the type that declared them, so a draft's values and pictures mean nothing to
 * the type it is changing to and would be stranded under ids the new type has never heard of.
 * Fields sharing a name keep their material; whatever is left falls into the slots still free, in
 * order, which is what lands a Front and a Back in a Text and an Extra. Material the new type has
 * no field for is dropped, since there would be nowhere to show it or edit it back out.
 */
export function retypeDraft(draft: FactDraft, from: CardTypeDto | undefined, to: CardTypeDto): FactDraft {
  if (!from || from.id === to.id) return { ...draft, typeId: to.id }

  const byName = new Map(to.fields.map((field) => [fieldKey(field.name), field.id]))
  const taken = new Set<string>()
  const moves: [string, string][] = []

  for (const field of from.fields) {
    const target = byName.get(fieldKey(field.name))
    if (target === undefined || taken.has(target)) continue
    taken.add(target)
    moves.push([field.id, target])
  }

  // Whatever a name did not place goes into the slots nothing claimed, both sides read in the order
  // the type editor shows them, so the carry over is the one someone looking at the two lists would
  // have drawn themselves.
  const free = to.fields.filter((field) => !taken.has(field.id))
  for (const field of from.fields) {
    if (moves.some(([id]) => id === field.id)) continue
    const target = free.shift()
    if (!target) break
    moves.push([field.id, target.id])
  }

  const values: Record<string, string> = {}
  const media: Record<string, DraftAttachment[]> = {}
  for (const [before, after] of moves) {
    const value = draft.values[before]
    if (value) values[after] = value
    const attachments = draft.media[before]
    if (attachments && attachments.length > 0) media[after] = attachments
  }

  return { ...draft, typeId: to.id, values, media }
}

/**
 * The cards an edit would delete: the ones on disk whose layout no longer produces anything. The
 * server sweeps them with a hard delete, so their review history goes too, which is worth saying
 * out loud before a change of type rather than after.
 */
export function droppedCardCount(
  before: { type: CardTypeDto; draft: FactDraft },
  after: { type: CardTypeDto; draft: FactDraft },
): number {
  const kept = new Set(generate(after.type, asFactLike(after.draft)).map((card) => card.key))
  return generate(before.type, asFactLike(before.draft)).filter((card) => !kept.has(card.key)).length
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
