/**
 * Filtering and the on-grid count for the widget library.
 *
 * The desktop matches case- and accent-insensitively against "{Title} {Description} {Author}"; the
 * port folds diacritics and case the same way and keeps both the short and the gallery description
 * in the blob, so a widget stays findable by either. Pure so the panel can stay a thin renderer.
 */

/** Case- and accent-insensitive, matching the desktop's IgnoreCase | IgnoreNonSpace comparison. */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
}

/** The searchable text for one widget. Description is included but never shown on its own line. */
export function searchBlob(parts: { title: string; description: string; gallery: string; author: string }): string {
  return fold(`${parts.title} ${parts.description} ${parts.gallery} ${parts.author}`)
}

/** Whether a widget matches a query. An empty or whitespace query matches everything. */
export function matches(blob: string, query: string): boolean {
  const needle = fold(query.trim())
  return needle === "" || blob.includes(needle)
}
