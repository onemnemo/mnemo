// Hand-mirrors the C# DTO contracts defined in Mnemo.Host/Contracts. The C#
// side is authoritative; field names are the camelCase forms the minimal API
// emits (ASP.NET Core's default naming policy). Keep this file the single place
// TS deck types live; do not redeclare deck shapes elsewhere.

/** Mirrors Mnemo.Host/Contracts/DueCountsDto.cs. */
export interface DueCountsDto {
  "new": number
  learning: number
  due: number
  total: number
}

/** Mirrors Mnemo.Host/Contracts/DeckSummaryDto.cs. Dates are ISO 8601 strings. */
export interface DeckSummaryDto {
  id: string
  folderId: string | null
  name: string
  description: string | null
  tags: string[]
  sortOrder: number
  totalCards: number
  activeCards: number
  suspendedCards: number
  dueCounts: DueCountsDto
  retentionPercent: number
  lastStudied: string | null
  createdAt: string
  updatedAt: string
}

/** Mirrors Mnemo.Host/Contracts/FlashcardLibraryDto.cs FolderDto. */
export interface FolderDto {
  id: string
  name: string
  parentId: string | null
  order: number
}

/** Body for creating or updating a folder. */
export interface SaveFolderDto {
  name: string
  parentId: string | null
  order: number
}

/** Body for creating a deck. A null preset falls back to the shared Standard preset. */
export interface CreateDeckDto {
  name: string
  folderId: string | null
  presetId: string | null
}

/** Body for updating a deck. Full replace of the editable header fields, not a patch. */
export interface UpdateDeckDto {
  name: string
  description: string | null
  tags: string[]
}

/** Body for re-homing a deck; a null folder is the library root. */
export interface MoveDeckDto {
  folderId: string | null
  sortOrder: number
}

/** Mirrors Mnemo.Host/Contracts/FlashcardLibraryDto.cs RetentionTrendPointDto. */
export interface RetentionTrendPointDto {
  day: string
  retentionPercent: number
  reviewsCount: number
}

// Card shapes. The host maps every flashcard enum to a lowercase token rather than
// letting it serialize as an integer, so these mirror as string unions - see
// Mnemo.Host/Contracts/FlashcardWire.cs.

export type CardType = "classic" | "cloze"
export type CardState = "active" | "suspended"
export type FsrsState = "new" | "learning" | "review" | "relearning"

/** The card-table filter chips. Note "flagged" is the one filter that also matches suspended cards. */
export type CardStateFilter = "all" | "due" | "new" | "learning" | "suspended" | "flagged"

export type CardSort = "due" | "front" | "type" | "reps" | "lapses" | "created"

/** Mirrors Mnemo.Host/Contracts/FlashcardCardDto.cs CardAttachmentDto. */
export interface CardAttachmentDto {
  id: string
  side: string
  displayName: string
  sizeBytes: number
  caption: string | null
}

/** Mirrors Mnemo.Host/Contracts/FlashcardCardDto.cs CardDto. */
export interface CardDto {
  id: string
  deckId: string
  type: CardType
  front: string
  back: string
  tags: string[]
  state: CardState
  isFlagged: boolean
  attachments: CardAttachmentDto[]
  createdAt: string
  updatedAt: string
}

/** Mirrors Mnemo.Host/Contracts/FlashcardCardDto.cs CardScheduleDto. */
export interface CardScheduleDto {
  dueDate: string
  stability: number | null
  difficulty: number | null
  reps: number
  lapses: number
  fsrsState: FsrsState
  learningStepIndex: number
  lastReviewedAt: string | null
}

/** A card paired with its schedule, as the deck table renders it. */
export interface CardViewDto {
  card: CardDto
  schedule: CardScheduleDto
}

/** One page of cards. `offset` and `limit` are the effective values the server used. */
export interface CardPageDto {
  items: CardViewDto[]
  totalCount: number
  offset: number
  limit: number
}

/** Body for creating a card. The server assigns id, timestamps and the initial schedule. */
export interface CreateCardDto {
  type: CardType
  front: string
  back: string
  tags: string[]
}

/** Body for updating a card. Full replace of the editable content fields, not a patch. */
export interface UpdateCardDto {
  type: CardType
  front: string
  back: string
  tags: string[]
}
