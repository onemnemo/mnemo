import { useEffect, useMemo, useState } from "react"

import { useT } from "@/i18n/useT"
import { SettingsPageShell } from "@/settings/components/kit"
import { SettingRow } from "@/settings/components/SettingRow"
import { SettingsGroupView } from "@/settings/components/SettingsGroupView"
import { SettingsNav } from "@/settings/components/SettingsNav"
import { UNTRANSLATED_CATEGORY_TITLES, visibleCategories } from "@/settings/schema"
import { searchSettings, type SettingsSearchMatch } from "@/settings/search"
import { useSettingsStore, useSettingValue } from "@/settings/store"

const DEFAULT_CATEGORY = "General"

/**
 * The settings page: a category rail beside the selected category's rows, or the
 * search results that replace them while a query is active.
 *
 * Everything on screen comes from walking the schema, so adding a setting is a schema
 * edit, there is no second place listing what settings exist.
 */
export function SettingsPage() {
  const t = useT()
  const load = useSettingsStore((s) => s.load)
  const loaded = useSettingsStore((s) => s.loaded)

  useEffect(() => {
    void load()
  }, [load])

  const developerGateUnlocked = useSettingValue("App.DeveloperModeGateUnlocked", false)
  const developerMode = useSettingValue("App.DeveloperMode", false)
  const context = useMemo(
    () => ({ developerGateUnlocked, developerMode }),
    [developerGateUnlocked, developerMode],
  )

  const categories = visibleCategories(context)
  const [requestedId, setRequestedId] = useState(DEFAULT_CATEGORY)
  const [query, setQuery] = useState("")

  // Turning developer mode off while on its page falls back rather than blanking.
  const selected =
    categories.find((c) => c.id === requestedId) ??
    categories.find((c) => c.id === DEFAULT_CATEGORY) ??
    categories[0]

  const matches = useMemo(() => searchSettings(query, t, context), [query, t, context])
  const searching = query.trim().length > 0

  function selectCategory(id: string) {
    // Selecting a category leaves search, matching the desktop.
    setQuery("")
    setRequestedId(id)
  }

  return (
    // Full height with its own rail, exactly like Notes: the frame's rail stays a list of modules
    // and never sprouts a second tree.
    <div className="flex h-full">
      <SettingsNav
        categories={categories}
        selectedId={searching ? "" : (selected?.id ?? "")}
        onSelect={selectCategory}
        query={query}
        onQueryChange={setQuery}
      />

      <main className="min-w-0 flex-1">
        {searching ? (
          <SearchResults query={query} matches={matches} />
        ) : selected ? (
          <SettingsPageShell
            title={UNTRANSLATED_CATEGORY_TITLES[selected.id] ?? t("Settings", selected.title)}
            description={selected.subtitle ? t("Settings", selected.subtitle) : undefined}
          >
            {selected.groups.map((group) => (
              <SettingsGroupView key={group.id} group={group} context={context} />
            ))}
          </SettingsPageShell>
        ) : null}

        {/* Rows read from a snapshot; until it lands they show schema defaults. */}
        {!loaded ? <p className="sr-only">Loading settings…</p> : null}
      </main>
    </div>
  )
}

/** The synthetic results category: matched rows, each tagged with where it lives. */
function SearchResults({ query, matches }: { query: string; matches: SettingsSearchMatch[] }) {
  const t = useT()

  const groups = matches.reduce<Map<string, SettingsSearchMatch[]>>((acc, match) => {
    const bucket = acc.get(match.breadcrumb)
    if (bucket) bucket.push(match)
    else acc.set(match.breadcrumb, [match])
    return acc
  }, new Map())

  return (
    <SettingsPageShell
      title={t("Settings", "SearchResults")}
      description={
        matches.length > 0
          ? t("Settings", "SearchResultsSubtitleFormat", { 0: matches.length, 1: query })
          : t("Settings", "SearchNoResultsFormat", { 0: query })
      }
    >
      {[...groups].map(([breadcrumb, rows]) => (
        <section key={breadcrumb} className="mt-8 first:mt-6">
          {/* The breadcrumb is where the row lives, which is the one thing a result needs to say
              that the row itself does not. */}
          <h2 className="mb-1 text-[12.5px] font-medium text-ink-3">{breadcrumb}</h2>
          {rows.map((match, i) => (
            <SettingRow key={`${breadcrumb}:${i}`} row={match.row} divider={i < rows.length - 1} />
          ))}
        </section>
      ))}
    </SettingsPageShell>
  )
}
