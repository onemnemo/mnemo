import { useEffect, useMemo, useState } from "react"

import { useT } from "@/i18n/useT"
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
    <div className="flex gap-10 p-[var(--page-padding)]">
      <SettingsNav
        categories={categories}
        selectedId={searching ? "" : (selected?.id ?? "")}
        onSelect={selectCategory}
        query={query}
        onQueryChange={setQuery}
      />

      <main className="min-w-0 max-w-3xl flex-1">
        {searching ? (
          <SearchResults query={query} matches={matches} />
        ) : selected ? (
          <>
            <header>
              <h1 className="text-heading-4 font-semibold text-text-primary">
                {UNTRANSLATED_CATEGORY_TITLES[selected.id] ?? t("Settings", selected.title)}
              </h1>
              {selected.subtitle ? (
                <p className="mt-0.5 text-body-small text-text-tertiary">
                  {t("Settings", selected.subtitle)}
                </p>
              ) : null}
            </header>

            <div className="mt-5">
              {selected.groups.map((group) => (
                <SettingsGroupView key={group.id} group={group} context={context} />
              ))}
            </div>
          </>
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
    <>
      <header>
        <h1 className="text-heading-4 font-semibold text-text-primary">
          {t("Settings", "SearchResults")}
        </h1>
        <p className="mt-0.5 text-body-small text-text-tertiary">
          {matches.length > 0
            ? t("Settings", "SearchResultsSubtitleFormat", { 0: matches.length, 1: query })
            : t("Settings", "SearchNoResultsFormat", { 0: query })}
        </p>
      </header>

      <div className="mt-5">
        {[...groups].map(([breadcrumb, rows]) => (
          <section key={breadcrumb} className="mt-7 first:mt-0">
            <h2 className="mb-1 text-micro font-semibold uppercase tracking-[1px] text-text-faded">
              {breadcrumb}
            </h2>
            {rows.map((match, i) => (
              <SettingRow
                key={`${breadcrumb}:${i}`}
                row={match.row}
                divider={i < rows.length - 1}
              />
            ))}
          </section>
        ))}
      </div>
    </>
  )
}
