/**
 * Turning the note list into the widget's rows: the window, the ordering and the meta line.
 *
 * Pure and separate from the hook, because this is the part that has to agree with the desktop
 * note for note, and none of it needs a renderer to check.
 */

import type { NoteFolderDto, NoteSummaryDto } from "@/api/types"

export interface RecentNoteRow {
  noteId: string
  title: string
  /** "Folder / Subfolder · 3 days ago", or just the date for a note at the library root. */
  meta: string
}

export interface RecentNoteOptions {
  /** How far back the window reaches, in days. */
  days: number
  /** Most rows to return. */
  limit: number
  /** The stored choice. Only the literal "date" means created; everything else means modified. */
  sortBy: string
  now: number
  /** Renders one note's timestamp, already bound to the caller's locale and translator. */
  formatDate: (timestamp: string, now: number) => string
  /** The localized fallback for a note with no title. */
  untitled: string
}

/**
 * Ancestor folder names, outermost first, joined the way the desktop joins them.
 *
 * The desktop stores this string on the note and refreshes it only when the note is created or
 * moved, so a renamed folder leaves a stale path behind. Composing it live from the folder list is
 * the only option here anyway, since the note DTO carries an id rather than a path, and it happens
 * to be the more correct of the two.
 */
export function folderPath(folders: readonly NoteFolderDto[], folderId: string | null): string {
  if (folderId === null) return ""

  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const names: string[] = []
  let current: string | null = folderId

  // A missing parent, or a cycle in the parent chain, must not hang the render. A truncated path
  // is a better outcome than a frozen board.
  const visited = new Set<string>()
  while (current !== null && !visited.has(current)) {
    visited.add(current)
    const folder: NoteFolderDto | undefined = byId.get(current)
    if (folder === undefined) break
    if (folder.name.trim() !== "") names.unshift(folder.name.trim())
    current = folder.parentId
  }

  return names.join(" / ")
}

export function buildRecentNoteRows(
  notes: readonly NoteSummaryDto[],
  folders: readonly NoteFolderDto[],
  options: RecentNoteOptions,
): RecentNoteRow[] {
  // Anything that is not the literal "date" sorts by last edited, including a value corrupted
  // outside the app. That is the desktop's comparison, not a validation of the stored choice.
  const byCreated = options.sortBy === "date"
  const stamp = (note: NoteSummaryDto) => new Date(byCreated ? note.createdAt : note.modifiedAt).getTime()

  const cutoff = options.now - options.days * 24 * 60 * 60 * 1000

  return notes
    .filter((note) => stamp(note) >= cutoff)
    .slice()
    .sort((left, right) => stamp(right) - stamp(left))
    .slice(0, options.limit)
    .map((note) => {
      // The date shown is the one the window was drawn on. The desktop always shows the modified
      // date, so sorting by creation date surfaces a note for being new and then labels it with a
      // stale edit; showing the field that selected it is the only reading that explains the row.
      const date = options.formatDate(byCreated ? note.createdAt : note.modifiedAt, options.now)
      const path = folderPath(folders, note.folderId)
      const title = note.title.trim()

      return {
        noteId: note.id,
        title: title === "" ? options.untitled : title,
        // U+00B7, and only when there is a folder to name. A note at the library root reads as the
        // date alone rather than as a leading separator.
        meta: path === "" ? date : `${path} · ${date}`,
      }
    })
}
