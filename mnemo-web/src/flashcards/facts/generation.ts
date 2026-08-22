import type { CardAttachmentDto, CardTypeDto, CardTypeLayoutDto } from "@/api/types"

/**
 * Turns a card type and the material filling it into the cards they currently make. Pure, so the
 * editor can call it on every keystroke to say how many cards a save would produce, before
 * anything is sent.
 *
 * This mirrors Mnemo.Infrastructure's generation, which is what actually writes the cards. The
 * two must agree; the tests either side cover the same cases.
 */

/** What a masked deletion reads as when it carries no hint. */
export const CLOZE_PLACEHOLDER = "[…]"

/** Generator tokens a card type can carry. Text, not an enum, so a later build reads as itself. */
export const CLOZE_GENERATOR = "cloze"
export const OCCLUSION_GENERATOR = "occlusion"

/**
 * What a deletion or its hint may contain: anything at all, except a blank line and except the
 * start of the next deletion.
 *
 * A deletion may wrap a line, because a deletion long enough to be a clause is normally typed as
 * one. It may not cross a blank line, which is where one thought ends and the marker was clearly
 * left unclosed. Refusing the next deletion's opening keeps a half typed `{{c1::` from swallowing
 * the finished marker after it. Mirrors FlashcardGeneration.ClozeBody, which has to agree.
 */
const CLOZE_BODY = String.raw`(?:(?!\r?\n\r?\n|\{\{c\d+::)[\s\S])+?`

const CLOZE_PATTERN = new RegExp(String.raw`\{\{c(\d+)::(${CLOZE_BODY})(?:::(${CLOZE_BODY}))?\}\}`, "g")
const FIELD_PATTERN = /\{\{([^{}]+)\}\}/g
const BLANK_RUN_PATTERN = /\n{3,}/g

/**
 * The material an editor is holding, keyed the way a fact stores it. Generic over the attachment,
 * so the editor can pass the drafts it is still holding rather than only what the server sent.
 */
export interface FactLike<TMedia = CardAttachmentDto> {
  values: Record<string, string>
  media: Record<string, TMedia[]>
}

/** One card the material makes. */
export interface GeneratedCard<TMedia = CardAttachmentDto> {
  /** Stable half of the card's identity: a layout id, or `c<n>` for a deletion. */
  key: string
  /** Names the card beside its siblings, or null when the generator decides the shape. */
  layoutName: string | null
  front: string
  back: string
  frontMedia: TMedia[]
  backMedia: TMedia[]
}

/** A layout that exists but is not firing, and the field name that would switch it on. */
export interface DormantLayout {
  layout: CardTypeLayoutDto
  requiredFieldName: string
}

function value<TMedia>(fact: FactLike<TMedia>, fieldId: string): string {
  return fact.values[fieldId] ?? ""
}

function mediaOn<TMedia>(fact: FactLike<TMedia>, fieldId: string): TMedia[] {
  return fact.media[fieldId] ?? []
}

function effectiveGenerateFrom(type: CardTypeDto): string {
  return type.generateFrom ? type.generateFrom : type.sortFieldId
}

/**
 * The deletion numbers present in a piece of text, ascending and deduplicated. A number too large
 * to be one is ignored rather than throwing, since it came from typed text.
 */
export function clozeOrdinals(text: string | null | undefined): number[] {
  if (!text) return []

  const found = new Set<number>()
  for (const match of text.matchAll(CLOZE_PATTERN)) {
    const ordinal = Number.parseInt(match[1], 10)
    if (Number.isSafeInteger(ordinal)) found.add(ordinal)
  }

  return [...found].sort((a, b) => a - b)
}

/**
 * One cloze card's view of the text: its own deletion hidden, every other one shown. The others
 * are the context that makes the question answerable. A `::hint` is shown in place of the
 * placeholder where one was written.
 */
export function maskCloze(text: string | null | undefined, ordinal: number, reveal: boolean): string {
  if (!text) return ""

  return text.replace(CLOZE_PATTERN, (_full, digits: string, answer: string, hint?: string) => {
    const n = Number.parseInt(digits, 10)
    if (n !== ordinal || reveal) return answer
    return hint === undefined ? CLOZE_PLACEHOLDER : `[${hint}]`
  })
}

/** Field names a template mentions, in the order they appear. */
export function fieldsUsed(template: string | null | undefined): string[] {
  if (!template) return []
  return [...template.matchAll(FIELD_PATTERN)].map((match) => match[1].trim())
}

function fieldIdsByName(type: CardTypeDto): Map<string, string> {
  // Assignment rather than insert-once: two fields sharing a name is a state the type editor can
  // pass through, and the later one winning matches how a template reads top to bottom.
  const byName = new Map<string, string>()
  for (const field of type.fields) byName.set(field.name.trim().toLowerCase(), field.id)
  return byName
}

/**
 * Substitutes `{{Field}}` markers against the material. A marker naming a field the type no longer
 * has is dropped rather than printed, along with the blank line it leaves behind, so a stale
 * layout looks thin instead of showing markup to someone mid review.
 */
export function renderSide<TMedia>(
  template: string | null | undefined,
  type: CardTypeDto,
  fact: FactLike<TMedia>,
): string {
  if (!template) return ""

  const byName = fieldIdsByName(type)
  const substituted = template.replace(FIELD_PATTERN, (_full, name: string) => {
    const id = byName.get(name.trim().toLowerCase())
    return id === undefined ? "" : value(fact, id).trim()
  })

  return substituted.replace(BLANK_RUN_PATTERN, "\n\n").trim()
}

/** The key a cloze deletion number is stored under. */
export function clozeKey(ordinal: number): string {
  return `c${ordinal}`
}

/** The deletion number a cloze key names, or null when the key is not one. */
export function clozeOrdinalFromKey(key: string | null | undefined): number | null {
  if (!key || key.length < 2 || key[0] !== "c") return null
  if (!/^\d+$/.test(key.slice(1))) return null
  return Number.parseInt(key.slice(1), 10)
}

function filled<TMedia>(fact: FactLike<TMedia>, fieldId: string | null): boolean {
  return !fieldId || value(fact, fieldId).trim().length > 0
}

function joinParagraphs(parts: string[]): string {
  return parts.filter((part) => part.length > 0).join("\n\n")
}

function mediaFor<TMedia>(template: string, type: CardTypeDto, fact: FactLike<TMedia>): TMedia[] {
  if (Object.keys(fact.media).length === 0) return []

  const byName = fieldIdsByName(type)
  return fieldsUsed(template).flatMap((name) => {
    const id = byName.get(name.toLowerCase())
    return id === undefined ? [] : mediaOn(fact, id)
  })
}

function generateCloze<TMedia>(type: CardTypeDto, fact: FactLike<TMedia>, source: string): GeneratedCard<TMedia>[] {
  const text = value(fact, source)
  const extra = type.fields.find((field) => field.id !== source)
  const tail = extra ? value(fact, extra.id).trim() : ""
  const extraMedia = extra ? mediaOn(fact, extra.id) : []

  return clozeOrdinals(text).map((ordinal) => ({
    key: clozeKey(ordinal),
    layoutName: null,
    front: maskCloze(text, ordinal, false),
    back: joinParagraphs([maskCloze(text, ordinal, true), tail]),
    // The figure stays up while the text is blanked. It is what the sentence is read against,
    // not the answer to it.
    frontMedia: mediaOn(fact, source),
    backMedia: extraMedia,
  }))
}

function generateOcclusion<TMedia>(type: CardTypeDto, fact: FactLike<TMedia>, source: string): GeneratedCard<TMedia>[] {
  const rest = type.fields.filter((field) => field.id !== source)

  return [
    {
      key: "m1",
      layoutName: null,
      front: value(fact, source),
      back: joinParagraphs(rest.map((field) => value(fact, field.id).trim())),
      frontMedia: mediaOn(fact, source),
      backMedia: rest.flatMap((field) => mediaOn(fact, field.id)),
    },
  ]
}

/** Every card the material currently makes, in the order they are shown. */
export function generate<TMedia>(type: CardTypeDto, fact: FactLike<TMedia>): GeneratedCard<TMedia>[] {
  const source = effectiveGenerateFrom(type)

  if (type.generator === CLOZE_GENERATOR) return generateCloze(type, fact, source)
  if (type.generator === OCCLUSION_GENERATOR) return generateOcclusion(type, fact, source)

  return type.layouts
    .filter((layout) => filled(fact, layout.requires))
    .map((layout) => ({
      key: layout.id,
      layoutName: layout.name,
      front: renderSide(layout.front, type, fact),
      back: renderSide(layout.back, type, fact),
      frontMedia: mediaFor(layout.front, type, fact),
      backMedia: mediaFor(layout.back, type, fact),
    }))
}

/**
 * Layouts that exist but are not firing, with the field that would switch each one on. Empty for
 * a generated type, whose cards come from the content rather than from a list.
 */
export function dormant<TMedia>(type: CardTypeDto, fact: FactLike<TMedia>): DormantLayout[] {
  if (type.generator) return []

  return type.layouts
    .filter((layout) => !filled(fact, layout.requires))
    .map((layout) => ({
      layout,
      requiredFieldName: type.fields.find((field) => field.id === layout.requires)?.name ?? "",
    }))
}
