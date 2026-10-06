import type { CardTypeDto, FactDto, SaveFactDto } from "@/api/types"

import { draftFromStored, type DraftAttachment } from "../editor/draft"
import { OCCLUSION_GENERATOR, generate, type FactLike, type GeneratedCard } from "./generation"
import { OCCLUSION_IMAGE_FIELD, OCCLUSION_MASKS_FIELD, occlusionFieldTooLong, parseOcclusion } from "./occlusion"

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

/** The image and masks fields of an occlusion type are filled by its editor, never by a carry over. */
function isOcclusionOwned(type: CardTypeDto, fieldId: string): boolean {
  return type.generator === OCCLUSION_GENERATOR && (fieldId === OCCLUSION_IMAGE_FIELD || fieldId === OCCLUSION_MASKS_FIELD)
}

/**
 * Moves a draft onto another card type, carrying what it holds.
 *
 * Field ids belong to the type that declared them, so a draft's values and pictures mean nothing to
 * the type it is changing to and would be stranded under ids the new type has never heard of.
 * Fields sharing a name keep their material; whatever is left falls into the slots still free, in
 * order, which is what lands a Front and a Back in a Text and an Extra. Material the new type has
 * no field for is dropped, since there would be nowhere to show it or edit it back out.
 *
 * An occlusion type is the exception: its masks never carry or fill, and the first picture of any
 * other type lands on its image field. Its picture is dropped when the new type has no image field.
 */
export function retypeDraft(draft: FactDraft, from: CardTypeDto | undefined, to: CardTypeDto): FactDraft {
  if (!from || from.id === to.id) return { ...draft, typeId: to.id }

  const sources = from.fields.filter((field) => !isOcclusionOwned(from, field.id))
  const targets = to.fields.filter((field) => !isOcclusionOwned(to, field.id))
  const byName = new Map(targets.map((field) => [fieldKey(field.name), field.id]))
  const taken = new Set<string>()
  const moves: [string, string][] = []

  for (const field of sources) {
    const target = byName.get(fieldKey(field.name))
    if (target === undefined || taken.has(target)) continue
    taken.add(target)
    moves.push([field.id, target])
  }

  // Whatever a name did not place goes into the slots nothing claimed, both sides read in the order
  // the type editor shows them, so the carry over is the one someone looking at the two lists would
  // have drawn themselves.
  const free = targets.filter((field) => !taken.has(field.id))
  for (const field of sources) {
    if (moves.some(([id]) => id === field.id)) continue
    const target = free.shift()
    if (!target) break
    moves.push([field.id, target.id])
  }

  const toOcclusion = to.generator === OCCLUSION_GENERATOR
  const values: Record<string, string> = {}
  const media: Record<string, DraftAttachment[]> = {}
  for (const [before, after] of moves) {
    const value = draft.values[before]
    if (value) values[after] = value
    const attachments = draft.media[before]
    if (!toOcclusion && attachments && attachments.length > 0) media[after] = attachments
  }

  if (toOcclusion) {
    const picture = from.fields.map((field) => draft.media[field.id]?.[0]).find((attachment) => attachment !== undefined)
    if (picture) media[OCCLUSION_IMAGE_FIELD] = [picture]
  }

  return { ...draft, typeId: to.id, values, media }
}

/** What an occlusion draft holds that no other type can carry: its picture and its masks. */
export interface OcclusionStash {
  typeId: string
  masks: string | undefined
  image: DraftAttachment[] | undefined
}

/** Takes the picture and masks out of a draft before it moves to a type that would drop them. */
export function stashOcclusion(draft: FactDraft): OcclusionStash {
  return { typeId: draft.typeId, masks: draft.values[OCCLUSION_MASKS_FIELD], image: draft.media[OCCLUSION_IMAGE_FIELD] }
}

/** Puts a stash back on a draft that has just moved onto the type it came from. */
export function restoreOcclusion(draft: FactDraft, stash: OcclusionStash): FactDraft {
  const values = { ...draft.values }
  if (stash.masks) values[OCCLUSION_MASKS_FIELD] = stash.masks
  const media = { ...draft.media }
  if (stash.image) media[OCCLUSION_IMAGE_FIELD] = stash.image
  return { ...draft, values, media }
}

/**
 * The cards an edit would move to the trash: those on disk whose layout no longer produces anything,
 * with their review history. Worth saying before a change of type rather than after.
 */
export function droppedCards(
  before: { type: CardTypeDto; draft: FactDraft },
  after: { type: CardTypeDto; draft: FactDraft },
): GeneratedCard<DraftAttachment>[] {
  const kept = new Set(generate(after.type, asFactLike(after.draft)).map((card) => card.key))
  return generate(before.type, asFactLike(before.draft)).filter((card) => !kept.has(card.key))
}

export function droppedCardCount(
  before: { type: CardTypeDto; draft: FactDraft },
  after: { type: CardTypeDto; draft: FactDraft },
): number {
  return droppedCards(before, after).length
}

/** What saving a draft over the stored material does to the cards that already exist. */
export interface CardLoss {
  /** The cards that would move to the trash. */
  removed: GeneratedCard<DraftAttachment>[]
  /** How many of the existing cards the save leaves alone. */
  kept: number
}

/** Nothing is lost for new material, or when the stored type is no longer on the list. */
export function cardLoss(
  loaded: FactDto | undefined,
  types: readonly CardTypeDto[],
  type: CardTypeDto | undefined,
  draft: FactDraft,
): CardLoss {
  const previous = loaded ? types.find((candidate) => candidate.id === loaded.typeId) : undefined
  if (!loaded || !previous || !type) return { removed: [], kept: 0 }
  const before = { type: previous, draft: draftFromFact(loaded) }
  const removed = droppedCards(before, { type, draft })
  return { removed, kept: generate(previous, asFactLike(before.draft)).length - removed.length }
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
  // An image with at least one mask makes cards; the labels and the text around them are optional.
  if (type.generator === OCCLUSION_GENERATOR) {
    return !occlusionFieldTooLong(draft.values[OCCLUSION_MASKS_FIELD]) && generate(type, asFactLike(draft)).length > 0
  }
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
    .filter(([fieldId, value]) => value.length > 0 && !(fieldId === OCCLUSION_MASKS_FIELD && parseOcclusion(value).masks.length === 0))
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
