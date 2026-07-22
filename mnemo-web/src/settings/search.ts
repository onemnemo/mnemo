import type { TranslateFn } from "@/i18n/types"

import { rowDescription, rowTitle } from "./labels"
import { isRowHidden, visibleCategories } from "./schema"
import type { SettingsSchemaContext, SettingsRow } from "./types"

// Cross-category search. Because the tree is declared as data, this is a filter over
// the same schema the page renders, there is no second description of the settings
// that could fall out of step with what is on screen.

/** One row that matched, tagged with where it came from. */
export interface SettingsSearchMatch {
  categoryId: string
  /** "Category > Group", or just the category when the group is unnamed. */
  breadcrumb: string
  row: SettingsRow
}

/**
 * Rows whose title or description contains `query`, case-insensitively.
 *
 * Substring only, matching the desktop: no fuzzy matching, and storage keys are not
 * searched. Subheaders and notices are skipped (nothing to change); a group's master
 * toggle is included, so the AI switch is findable by name.
 */
export function searchSettings(
  query: string,
  t: TranslateFn,
  context: SettingsSchemaContext,
): SettingsSearchMatch[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []

  const matches: SettingsSearchMatch[] = []

  for (const category of visibleCategories(context)) {
    const categoryTitle = t("Settings", category.title)

    for (const group of category.groups) {
      const groupTitle = group.title ? t("Settings", group.title) : ""
      const breadcrumb = groupTitle ? `${categoryTitle} › ${groupTitle}` : categoryTitle

      const candidates: SettingsRow[] = group.master ? [group.master, ...group.rows] : group.rows
      for (const row of candidates) {
        if (row.kind === "subheader" || row.kind === "notice") continue
        if ("key" in row && isRowHidden(row.key, context)) continue
        if (!rowMatches(row, needle, t)) continue

        matches.push({ categoryId: category.id, breadcrumb, row })
      }
    }
  }

  return matches
}

function rowMatches(row: SettingsRow, needle: string, t: TranslateFn): boolean {
  const haystack = `${rowTitle(row, t)}\n${rowDescription(row, t)}`.toLocaleLowerCase()
  return haystack.includes(needle)
}
