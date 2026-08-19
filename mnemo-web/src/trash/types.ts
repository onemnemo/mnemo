// Hand-mirrors Mnemo.Host/Contracts/TrashDto.cs. The C# side is authoritative; field names are
// the camelCase forms the minimal API emits.

/** One recoverable item. */
export interface TrashEntryDto {
  id: string
  /** Which module owns it: "note", "note-folder", "mindmap", "mindmap-folder", "deck", "deck-folder", "card", "fact". */
  kind: string
  itemId: string
  title: string
  /** Where it was, written for a person. Null when it was at a root. */
  origin: string | null
  /** How much went with it. Zero for something that took nothing. */
  containedCount: number
  /** Everything deleted by one action shares this, and Undo works on it. */
  batchId: string
  deletedAt: string
  expiresAt: string
  /** False when this build ships no module for the kind: the row is shown but cannot be acted on. */
  sourceAvailable: boolean
}

/** What a delete produced. Every module delete endpoint answers with this. */
export interface TrashActionDto {
  batchId: string
  entries: TrashEntryDto[]
  skippedCount: number
}

/** One page of the trash, newest first. */
export interface TrashPageDto {
  entries: TrashEntryDto[]
  nextCursor: string | null
}

export interface TrashCountDto {
  count: number
}

/** What happened to one entry a restore touched. */
export type TrashRestoreOutcome = "restored" | "missing" | "rooted" | "destination_required" | "container_held"

export interface TrashRestoreResultDto {
  entryId: string
  kind: string
  itemId: string
  title: string
  outcome: TrashRestoreOutcome
  destinationId: string | null
  destinationName: string | null
}

export interface TrashRestoreResponseDto {
  results: TrashRestoreResultDto[]
  restoredCount: number
  /** Entries still held: they need a destination, or their container is held too. */
  pendingCount: number
}

/** What a permanent deletion did, or what stopped it. */
export interface TrashPurgeResultDto {
  entryId: string
  title: string
  purged: boolean
  /** Entries holding content the same destruction would reach. Handle these first. */
  blockingEntryIds: string[]
}

export interface TrashEmptyResultDto {
  purgedCount: number
  blocked: TrashPurgeResultDto[]
}
