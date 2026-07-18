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
