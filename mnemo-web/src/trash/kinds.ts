import type { TranslateFn } from "@/i18n/types"

/** How one kind of deleted thing is drawn and named. */
interface TrashKind {
  icon: string
  /** Key in the Trash namespace. */
  labelKey: string
}

/**
 * The kinds this build knows how to draw.
 *
 * The server is the authority on what kinds exist: a module ships its own source and can be
 * absent, so the trash can hold a row this app has no entry for. That is why lookups fall back
 * rather than throwing, and why the entry's own `sourceAvailable` decides what can be done with
 * a row, not this table.
 *
 * Every folder kind is named after what it holds. They are separate kinds on the server and a
 * filter picks exactly one, so three rows all reading "Folder" would be three different filters
 * wearing one name.
 */
const KINDS: Record<string, TrashKind> = {
  note: { icon: "common/file-text", labelKey: "KindNote" },
  "note-folder": { icon: "common/folder", labelKey: "KindNoteFolder" },
  mindmap: { icon: "sidebar/mindmap", labelKey: "KindMindmap" },
  "mindmap-folder": { icon: "common/folder", labelKey: "KindMindmapFolder" },
  deck: { icon: "sidebar/flashcard", labelKey: "KindDeck" },
  "deck-folder": { icon: "common/folder", labelKey: "KindDeckFolder" },
  card: { icon: "square-stack", labelKey: "KindCard" },
  fact: { icon: "layers", labelKey: "KindFact" },
}

export function kindIcon(kind: string): string {
  return KINDS[kind]?.icon ?? "common/trash"
}

/** The kind written for a person, or the raw kind when this build has no name for it. */
export function kindLabel(kind: string, t: TranslateFn): string {
  const known = KINDS[kind]
  return known ? t("Trash", known.labelKey) : kind
}

/**
 * The kinds offered as filters, module by module.
 *
 * Each one is a kind the server matches exactly, so there is no grouped "Notes" option: it would
 * quietly hide deleted note folders from somebody who picked it to find them.
 */
export const FILTER_KINDS = [
  "note",
  "note-folder",
  "mindmap",
  "mindmap-folder",
  "deck",
  "deck-folder",
  "card",
  "fact",
] as const
