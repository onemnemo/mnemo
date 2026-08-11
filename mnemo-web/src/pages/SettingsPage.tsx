import { useEffect, useMemo, useState } from "react"

import { useHashRoute } from "@/app/router"
import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"
import { KeyboardPage } from "@/settings/components/pages/KeyboardPage"
import { SettingsPageShell } from "@/settings/components/kit"
import { SettingRow } from "@/settings/components/SettingRow"
import { SettingsGroupView } from "@/settings/components/SettingsGroupView"
import { SettingsNav } from "@/settings/components/SettingsNav"
import { UNTRANSLATED_CATEGORY_TITLES, visibleCategories } from "@/settings/schema"
import { searchCategories, searchSettings, type SettingsSearchMatch } from "@/settings/search"
import { useSettingsStore, useSettingValue } from "@/settings/store"
import type { SettingsCategory, SettingsPageId } from "@/settings/types"

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

  // "#/settings/keyboard" opens a page directly, which is how the shortcut that used to
  // raise the quick-actions catalogue reaches its replacement. Read here rather than
  // taken as a route parameter, so the sub-route stays this page's own business.
  const routedId = useRoutedCategoryId(categories)
  useEffect(() => {
    if (!routedId) return
    setQuery("")
    setRequestedId(routedId)
  }, [routedId])

  // Turning developer mode off while on its page falls back rather than blanking.
  const selected =
    categories.find((c) => c.id === requestedId) ??
    categories.find((c) => c.id === DEFAULT_CATEGORY) ??
    categories[0]

  const matches = useMemo(() => searchSettings(query, t, context), [query, t, context])
  const pageHits = useMemo(() => searchCategories(query, t, context), [query, t, context])
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

      {/* A div, not a second <main>: the shell already provides the page's one main landmark. */}
      <div className="min-w-0 flex-1">
        {searching ? (
          <SearchResults query={query} matches={matches} pages={pageHits} onOpenPage={selectCategory} />
        ) : selected ? (
          <SettingsPageShell
            title={UNTRANSLATED_CATEGORY_TITLES[selected.id] ?? t("Settings", selected.title)}
            description={selected.subtitle ? t("Settings", selected.subtitle) : undefined}
          >
            {selected.page ? (
              <SettingsCategoryPage id={selected.page} />
            ) : (
              selected.groups.map((group) => (
                <SettingsGroupView key={group.id} group={group} context={context} />
              ))
            )}
          </SettingsPageShell>
        ) : null}

        {/* Rows read from a snapshot; until it lands they show schema defaults. */}
        {!loaded ? <p className="sr-only">Loading settings…</p> : null}
      </div>
    </div>
  )
}

/**
 * The category named by the hash, if it names one this build has.
 *
 * Matched case-insensitively against the schema's ids so a link can be written the way
 * a URL reads ("#/settings/keyboard") rather than the way the schema spells it.
 */
function useRoutedCategoryId(categories: SettingsCategory[]): string | undefined {
  const hash = useHashRoute()
  return useMemo(() => {
    const segments = hash.replace(/^#\/?/, "").split("/").filter(Boolean)
    if (segments[0] !== "settings" || !segments[1]) return undefined
    const wanted = segments[1].toLowerCase()
    return categories.find((category) => category.id.toLowerCase() === wanted)?.id
  }, [hash, categories])
}

/** The body of a category that renders one bespoke surface instead of schema rows. */
function SettingsCategoryPage({ id }: { id: SettingsPageId }) {
  switch (id) {
    case "keyboard":
      return <KeyboardPage />
  }
}

/** The synthetic results category: matched pages, then matched rows tagged with where they live. */
function SearchResults({
  query,
  matches,
  pages,
  onOpenPage,
}: {
  query: string
  matches: SettingsSearchMatch[]
  pages: SettingsCategory[]
  onOpenPage: (id: string) => void
}) {
  const t = useT()

  const groups = matches.reduce<Map<string, SettingsSearchMatch[]>>((acc, match) => {
    const bucket = acc.get(match.breadcrumb)
    if (bucket) bucket.push(match)
    else acc.set(match.breadcrumb, [match])
    return acc
  }, new Map())

  const total = matches.length + pages.length

  return (
    <SettingsPageShell
      title={t("Settings", "SearchResults")}
      description={
        total > 0
          ? t("Settings", "SearchResultsSubtitleFormat", { 0: total, 1: query })
          : t("Settings", "SearchNoResultsFormat", { 0: query })
      }
    >
      {pages.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-1 text-[12.5px] font-medium text-ink-3">{t("Settings", "SearchPages")}</h2>
          {pages.map((category, i) => (
            <button
              key={category.id}
              type="button"
              onClick={() => onOpenPage(category.id)}
              className={cn(
                "flex w-full items-center gap-2.5 py-3 text-left",
                i < pages.length - 1 && "border-b border-line-soft",
              )}
            >
              <AppIcon name={category.icon} size={16} strokeWidth={1.5} className="shrink-0 text-ink-icon" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] text-ink">
                  {UNTRANSLATED_CATEGORY_TITLES[category.id] ?? t("Settings", category.title)}
                </span>
                {category.subtitle ? (
                  <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-3">
                    {t("Settings", category.subtitle)}
                  </span>
                ) : null}
              </span>
              <AppIcon name="chevron-right" size={14} strokeWidth={1.8} className="shrink-0 text-ink-icon" />
            </button>
          ))}
        </section>
      ) : null}

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
