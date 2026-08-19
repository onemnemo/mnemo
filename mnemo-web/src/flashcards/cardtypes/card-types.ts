import type { CardTypeSummaryDto, SaveCardTypeDto } from "@/api/types"

/**
 * The card type manager's working copy. Edits are held here until Save, so a half finished type
 * never reaches the store, and every fact using the type is regenerated the moment one does.
 */
export interface CardTypeFieldDraft {
  id: string
  name: string
  hint: string
}

export interface CardTypeLayoutDraft {
  id: string
  name: string
  front: string
  back: string
  /** Field id that must hold a value for this card to be made, or null to always make it. */
  requires: string | null
}

export interface CardTypeDraft {
  /** Stable while the dialog is open, so a row survives the type getting its real id on save. */
  key: string
  serverId: string | null
  name: string
  isBuiltIn: boolean
  /** Set on a type whose cards come from the content of a field rather than from layouts. */
  generator: string | null
  generateFrom: string | null
  fields: CardTypeFieldDraft[]
  sortFieldId: string
  layouts: CardTypeLayoutDraft[]
  factCount: number
  dirty: boolean
}

/** Why a draft cannot be saved, as translation keys the dialog renders in order. */
export type CardTypeProblem =
  | "CardTypesErrorName"
  | "CardTypesErrorFields"
  | "CardTypesErrorFieldName"
  | "CardTypesErrorSortField"
  | "CardTypesErrorCards"
  | "CardTypesErrorCardSides"

function localId(): string {
  return crypto.randomUUID().replace(/-/g, "")
}

export function draftFromSummary(summary: CardTypeSummaryDto): CardTypeDraft {
  const type = summary.type
  return {
    key: type.id,
    serverId: type.id,
    name: type.name,
    isBuiltIn: type.isBuiltIn,
    generator: type.generator,
    generateFrom: type.generateFrom,
    fields: type.fields.map((field) => ({ id: field.id, name: field.name, hint: field.hint ?? "" })),
    sortFieldId: type.sortFieldId,
    layouts: type.layouts.map((layout) => ({
      id: layout.id,
      name: layout.name,
      front: layout.front,
      back: layout.back,
      requires: layout.requires,
    })),
    factCount: summary.factCount,
    dirty: false,
  }
}

/**
 * A type to start from: the two fields and the one card almost every type begins with, so a new
 * type is usable before anything is typed into it.
 */
export function newDraft(name: string, frontName: string, backName: string, cardName: string): CardTypeDraft {
  const front: CardTypeFieldDraft = { id: localId(), name: frontName, hint: "" }
  const back: CardTypeFieldDraft = { id: localId(), name: backName, hint: "" }
  return {
    key: `new:${localId()}`,
    serverId: null,
    name,
    isBuiltIn: false,
    generator: null,
    generateFrom: null,
    fields: [front, back],
    sortFieldId: front.id,
    layouts: [
      {
        id: localId(),
        name: cardName,
        front: marker(frontName),
        back: marker(backName),
        requires: null,
      },
    ],
    factCount: 0,
    dirty: true,
  }
}

/** The marker a template shows a field through. */
export function marker(fieldName: string): string {
  return `{{${fieldName.trim()}}}`
}

export function addField(draft: CardTypeDraft, name: string): CardTypeDraft {
  return {
    ...draft,
    fields: [...draft.fields, { id: localId(), name, hint: "" }],
    dirty: true,
  }
}

export function patchField(draft: CardTypeDraft, fieldId: string, patch: Partial<CardTypeFieldDraft>): CardTypeDraft {
  return {
    ...draft,
    fields: draft.fields.map((field) => (field.id === fieldId ? { ...field, ...patch } : field)),
    dirty: true,
  }
}

/**
 * Drops a field, and any card that was waiting on it: a card whose condition names a field that is
 * gone would never be made again, and the server refuses to store one either way. Templates keep
 * their markers, which render as nothing, so the text a card was written with survives a field
 * being removed and put back.
 */
export function removeField(draft: CardTypeDraft, fieldId: string): CardTypeDraft {
  const fields = draft.fields.filter((field) => field.id !== fieldId)
  if (fields.length === draft.fields.length) return draft
  return {
    ...draft,
    fields,
    sortFieldId: draft.sortFieldId === fieldId ? (fields[0]?.id ?? "") : draft.sortFieldId,
    layouts: draft.layouts.map((layout) =>
      layout.requires === fieldId ? { ...layout, requires: null } : layout,
    ),
    dirty: true,
  }
}

/** Field order is the order the editor asks for them in, so it is something to be able to fix. */
export function moveField(draft: CardTypeDraft, fieldId: string, delta: number): CardTypeDraft {
  const from = draft.fields.findIndex((field) => field.id === fieldId)
  const to = from + delta
  if (from < 0 || to < 0 || to >= draft.fields.length) return draft

  const fields = [...draft.fields]
  const [moved] = fields.splice(from, 1)
  fields.splice(to, 0, moved)
  return { ...draft, fields, dirty: true }
}

export function addLayout(draft: CardTypeDraft, name: string): CardTypeDraft {
  return {
    ...draft,
    layouts: [...draft.layouts, { id: localId(), name, front: "", back: "", requires: null }],
    dirty: true,
  }
}

export function patchLayout(
  draft: CardTypeDraft,
  layoutId: string,
  patch: Partial<CardTypeLayoutDraft>,
): CardTypeDraft {
  return {
    ...draft,
    layouts: draft.layouts.map((layout) => (layout.id === layoutId ? { ...layout, ...patch } : layout)),
    dirty: true,
  }
}

export function removeLayout(draft: CardTypeDraft, layoutId: string): CardTypeDraft {
  return {
    ...draft,
    layouts: draft.layouts.filter((layout) => layout.id !== layoutId),
    dirty: true,
  }
}

/**
 * Everything that would stop this type from working, checked here so the dialog can say which one
 * it is rather than letting the save come back as a refusal with no field to point at.
 */
export function problems(draft: CardTypeDraft): CardTypeProblem[] {
  const found: CardTypeProblem[] = []
  if (draft.name.trim().length === 0) found.push("CardTypesErrorName")
  if (draft.fields.length === 0) found.push("CardTypesErrorFields")

  const names = new Set<string>()
  let badName = false
  for (const field of draft.fields) {
    const name = field.name.trim().toLowerCase()
    // Templates name a field by its name, so two fields sharing one leaves the second unreachable.
    if (name.length === 0 || names.has(name)) badName = true
    names.add(name)
  }
  if (badName) found.push("CardTypesErrorFieldName")

  if (draft.fields.length > 0 && !draft.fields.some((field) => field.id === draft.sortFieldId))
    found.push("CardTypesErrorSortField")

  // A generated type makes its cards from what is written in a field, so it has no layouts to check.
  if (draft.generator) return found

  if (draft.layouts.length === 0) found.push("CardTypesErrorCards")
  if (draft.layouts.some((layout) => layout.front.trim().length === 0 || layout.back.trim().length === 0))
    found.push("CardTypesErrorCardSides")

  return found
}

export function canSave(drafts: readonly CardTypeDraft[]): boolean {
  return drafts.some((draft) => draft.dirty) && drafts.every((draft) => problems(draft).length === 0)
}

export function toSaveDto(draft: CardTypeDraft): SaveCardTypeDto {
  return {
    id: draft.serverId,
    name: draft.name.trim(),
    fields: draft.fields.map((field) => ({
      id: field.id,
      name: field.name.trim(),
      hint: field.hint.trim().length > 0 ? field.hint.trim() : null,
    })),
    sortFieldId: draft.sortFieldId,
    // A generated type's layouts are whatever the generator makes, so nothing is claimed for it.
    layouts: draft.generator
      ? []
      : draft.layouts.map((layout) => ({
          id: layout.id,
          name: layout.name.trim(),
          front: layout.front,
          back: layout.back,
          requires: layout.requires,
        })),
  }
}

/** A name no other type in the list is using, so two new types are told apart on sight. */
export function uniqueName(base: string, taken: readonly string[]): string {
  const lower = new Set(taken.map((name) => name.trim().toLowerCase()))
  if (!lower.has(base.toLowerCase())) return base

  let suffix = 2
  while (lower.has(`${base} ${suffix}`.toLowerCase())) suffix++
  return `${base} ${suffix}`
}
