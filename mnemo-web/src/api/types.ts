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
  presetId: string
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

// Test practice. Test scores itself and writes no schedule, so there is no session to hold: the
// whole queue crosses once and the client runs it, coming back only to record what happened.

/** Mirrors Mnemo.Host/Contracts/TestSessionDto.cs TestQueueDto. */
export interface TestQueueDto {
  deckId: string
  deckName: string
  /** Server-stamped and echoed back, so the elapsed time is measured on one clock. */
  startedAt: string
  cards: CardDto[]
}

/** Mirrors Mnemo.Host/Contracts/TestSessionDto.cs RecordTestAttemptDto. The score is derived server-side. */
export interface RecordTestAttemptDto {
  startedAt: string
  gotIt: number
  close: number
  missed: number
}

/**
 * Mirrors Mnemo.Host/Contracts/TestSessionDto.cs TestResultDto. `trend` is chronological and
 * includes the attempt just recorded, so it takes two points before a line says anything.
 */
export interface TestResultDto {
  scorePct: number
  deltaVsPrevious: number | null
  hasBest: boolean
  bestScorePct: number
  trend: number[]
}

/** Mirrors Mnemo.Host/Contracts/TestSessionDto.cs RecordTestActivityDto. Sent when the screen goes away. */
export interface RecordTestActivityDto {
  startedAt: string
  cardsTested: number
}

// Scheduling presets. A deck names exactly one, and several decks can name the same one - which
// is why a preset carries the count of decks it would affect.

export type SchedulingAlgorithm = "fsrs"

/** Mirrors Mnemo.Host/Contracts/PresetDto.cs PresetDto. */
export interface PresetDto {
  id: string
  name: string
  newPerDay: number
  maxReviewsPerDay: number
  algorithm: SchedulingAlgorithm
  /** A fraction, not a percentage: 0.9 is the 90% the dialog shows. */
  desiredRetention: number
  learningSteps: number[]
  shuffleOrder: boolean
  buryRelated: boolean
  autoReveal: AutoReveal
  deckCount: number
  isStandard: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Mirrors Mnemo.Host/Contracts/PresetDto.cs SavePresetDto. Smaller than PresetDto on purpose:
 * the id and timestamps are the server's, and the fields with no editor are carried forward
 * there rather than round-tripped through here.
 */
export interface SavePresetDto {
  name: string
  newPerDay: number
  maxReviewsPerDay: number
  desiredRetention: number
  learningSteps: number[]
  shuffleOrder: boolean
  buryRelated: boolean
  autoReveal: AutoReveal
}

// --- Import / export -------------------------------------------------------

/** How an import resolves an item that already exists. Only .mnemo packages carry ids to collide on. */
export type ConflictPolicy = "KeepBoth" | "Skip" | "Replace"

/** Mirrors Mnemo.Host/Contracts/TransferDto.cs TransferFormatDto. */
export interface TransferFormatDto {
  formatId: string
  displayName: string
  /** Lowercase and dotted, e.g. ".apkg". The first one is what an export of this format produces. */
  extensions: string[]
  supportsImport: boolean
  supportsExport: boolean
}

/** Mirrors Mnemo.Host/Contracts/TransferDto.cs TransferUploadDto. */
export interface TransferUploadDto {
  uploadId: string
  fileName: string
  sizeBytes: number
  formatId: string
  formatName: string
  /** False when the file staged but could not be read; the warnings say why. */
  canImport: boolean
  /** Null when the format cannot say how many cards it holds until it is imported (.mnemo). */
  cardCount: number | null
  warnings: string[]
}

/** Mirrors Mnemo.Host/Contracts/TransferDto.cs TransferImportDto. */
export interface TransferImportDto {
  uploadIds: string[]
  conflictPolicy: ConflictPolicy
}

/** Mirrors Mnemo.Host/Contracts/TransferDto.cs TransferImportResultDto. */
export interface TransferImportResultDto {
  succeededFiles: number
  failedFiles: number
  importedCards: number
  warnings: string[]
  errors: string[]
}

/** Mirrors Mnemo.Host/Contracts/TransferDto.cs TransferExportDto. */
export interface TransferExportDto {
  formatId: string
  deckIds: string[]
}

// --- Notes -----------------------------------------------------------------

/** Mirrors Mnemo.Host/Contracts/NoteDto.cs NoteSummaryDto. Dates are ISO 8601 strings. */
export interface NoteSummaryDto {
  id: string
  /** Short, corpus-unique note id. This is the one that crosses the tool boundary; `id` is internal. */
  sid: string
  /** Monotonic revision. Send it back as `baseVer` to commit content; it is how a stale write is caught. */
  ver: number
  title: string
  folderId: string | null
  parentNoteId: string | null
  order: number
  isFavorite: boolean
  createdAt: string
  modifiedAt: string
}

/**
 * Mirrors Mnemo.Host/Contracts/NoteDto.cs NoteDto.
 *
 * `blocks` is the stored block JSON exactly as the editor persisted it, so it is
 * typed as unknown here on purpose: the wire shape has legacy variants that only
 * the notes model knows how to read. Run it through `parseBlocks` from
 * `@/notes/model/wire` rather than reaching into it. Null means a note written
 * before the block editor existed, which has only `content`.
 */
export interface NoteDto extends NoteSummaryDto {
  content: string
  blocks: unknown[] | null
}

/** Mirrors Mnemo.Host/Contracts/NoteDto.cs CreateNoteDto. */
export interface CreateNoteDto {
  title?: string | null
  folderId?: string | null
  parentNoteId?: string | null
}

/**
 * Mirrors Mnemo.Host/Contracts/NoteDto.cs CommitNoteContentDto, the only shape that
 * writes note content.
 *
 * `baseVer` is the version the editor started from. The write lands only if the note is
 * still on it; otherwise the server answers 409 with the version it actually holds and the
 * client rebases. `requestId` must be stable across retries of the *same* edit and fresh
 * for a new one, replaying an id is read as "this already landed", not as a second edit.
 */
export interface CommitNoteContentDto {
  baseVer: number
  requestId: string
  blocks: unknown[]
}

/** Mirrors Mnemo.Host/Contracts/NoteDto.cs NoteCommitResultDto. */
export interface NoteCommitResultDto {
  outcome: "Applied" | "AlreadyApplied" | "Stale" | "NotFound"
  /** The note's version after the call, the new one when applied, the current one when stale. */
  ver: number
}

/**
 * Mirrors Mnemo.Host/Contracts/NoteDto.cs UpdateNoteMetadataDto. A full replace of
 * everything a client may set about a note; there is no content field because
 * content is never written this way.
 */
export interface UpdateNoteMetadataDto {
  title: string
  folderId: string | null
  parentNoteId: string | null
  order: number
  isFavorite: boolean
}

/** Mirrors Mnemo.Host/Contracts/NoteAssetDto.cs. The id is what an image block stores in `path`. */
export interface NoteAssetDto {
  assetId: string
  displayName: string
  sizeBytes: number
}

/** Mirrors Mnemo.Host/Contracts/NoteAssetDto.cs NoteAssetSessionDto. */
export interface NoteAssetSessionDto {
  sessionId: string
}

/** Mirrors Mnemo.Host/Contracts/NoteDto.cs NoteFolderDto. */
export interface NoteFolderDto {
  id: string
  name: string
  parentId: string | null
  order: number
}

/** Mirrors Mnemo.Host/Contracts/NoteDto.cs SaveNoteFolderDto. */
export interface SaveNoteFolderDto {
  name: string
  parentId: string | null
  order: number
}
