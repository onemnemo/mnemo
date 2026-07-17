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
