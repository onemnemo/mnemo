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

/** One side of a card an attachment belongs to. */
export type CardSide = "front" | "back"

/** Mirrors Mnemo.Host/Contracts/FlashcardCardDto.cs CardAttachmentDto. */
export interface CardAttachmentDto {
  id: string
  side: string
  displayName: string
  sizeBytes: number
  caption: string | null
  /** Null when the stored file sits outside the managed images directory and cannot be served. */
  assetId: string | null
}

/** Mirrors Mnemo.Host/Contracts/FlashcardCardDto.cs CardAssetDto. */
export interface CardAssetDto {
  assetId: string
  attachmentId: string
  displayName: string
  sizeBytes: number
}

/**
 * Mirrors Mnemo.Host/Contracts/FlashcardCardDto.cs CardAttachmentInputDto. `id` names an
 * attachment the card already has, `assetId` a freshly uploaded image. Either may be set, and
 * an unchanged attachment carries both; `id` wins, which is what keeps its stored file.
 */
export interface CardAttachmentInputDto {
  id: string | null
  assetId: string | null
  side: CardSide
  displayName: string | null
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

// Study session shapes. The session lives on the server; the client names it by id and
// re-renders from the whole state every call returns.

export type SessionMode = "review" | "cram" | "test"
export type SessionScope = "due" | "all"
export type ReviewGrade = "again" | "hard" | "good" | "easy"
export type AutoReveal = "off" | "five-seconds" | "ten-seconds"

/**
 * Mirrors Mnemo.Host/Contracts/StudySessionDto.cs StudyProgressDto. New/learning/due count what
 * is left to see, completed counts what has left the queue, so they do not sum to total
 * mid-session: a card graded back into a learning step is in neither group until it graduates.
 */
export interface StudyProgressDto {
  "new": number
  learning: number
  due: number
  completed: number
  total: number
}

/** Mirrors Mnemo.Host/Contracts/StudySessionDto.cs StudyIntervalsDto. Preformatted, e.g. "10m". */
export interface StudyIntervalsDto {
  again: string
  hard: string
  good: string
  easy: string
}

/**
 * Mirrors Mnemo.Host/Contracts/StudySessionDto.cs StudySessionDto. `current.front` carries the
 * card's stored text, cloze markers included - masking the prompt and revealing the answer is
 * the client's job. `startedEmpty` with `isFinished` is the "all caught up" case, as opposed to
 * a session the reader worked through.
 */
export interface StudySessionDto {
  sessionId: string
  deckId: string
  deckName: string
  mode: SessionMode
  scope: SessionScope
  writesSchedule: boolean
  autoReveal: AutoReveal
  startedEmpty: boolean
  isFinished: boolean
  canUndo: boolean
  /** Grades still standing; drives the confirm-on-leave prompt and the recorded effort. */
  graded: number
  current: CardDto | null
  progress: StudyProgressDto
  /** Null exactly when there is no current card. */
  intervals: StudyIntervalsDto | null
}

/** Body for starting a session. Scope only applies to cram; review always draws the schedule. */
export interface StartStudySessionDto {
  deckId: string
  mode: SessionMode
  scope: SessionScope | null
}

/**
 * Body for grading. `cardId` must be the card the reader is looking at: the server refuses a
 * grade aimed at anything but the head of its queue (409), so a double-tap or a retried request
 * cannot land on the next card instead of repeating the one it meant.
 */
export interface GradeCardDto {
  cardId: string
  grade: ReviewGrade
}

/** Body for creating a card. The server assigns id, timestamps and the initial schedule. */
export interface CreateCardDto {
  type: CardType
  front: string
  back: string
  tags: string[]
  attachments: CardAttachmentInputDto[]
}

/** Body for updating a card. Full replace of the editable content fields, not a patch. */
export interface UpdateCardDto {
  type: CardType
  front: string
  back: string
  tags: string[]
  attachments: CardAttachmentInputDto[]
  /** Re-homes the card when it names a different deck; null leaves it where it is. */
  deckId: string | null
}
