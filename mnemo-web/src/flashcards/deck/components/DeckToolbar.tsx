import type { CardStateFilter } from "@/api/types"
import { AppIcon } from "@/components/icon/AppIcon"
import { Menu, MenuContent, MenuItem, MenuSubMenu, MenuTrigger } from "@/components/ui/menu"
import { useT } from "@/i18n/useT"

import { useDeckView } from "../store"

const STATE_FILTERS: { value: Exclude<CardStateFilter, "all">; key: string }[] = [
  { value: "due", key: "StateFilterDue" },
  { value: "new", key: "StateFilterNew" },
  { value: "learning", key: "StateFilterLearning" },
  { value: "suspended", key: "StateFilterSuspended" },
  { value: "flagged", key: "StateFilterFlagged" },
]

/** Search box, the active filter chips, the add-filter pill and the result count. */
export function DeckToolbar({ knownTags, totalCount }: { knownTags: string[]; totalCount: number }) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

  const search = useDeckView((s) => s.search)
  const setSearch = useDeckView((s) => s.setSearch)
  const stateFilter = useDeckView((s) => s.stateFilter)
  const tagFilter = useDeckView((s) => s.tagFilter)
  const setStateFilter = useDeckView((s) => s.setStateFilter)
  const setTagFilter = useDeckView((s) => s.setTagFilter)
  const clearStateFilter = useDeckView((s) => s.clearStateFilter)
  const clearTagFilter = useDeckView((s) => s.clearTagFilter)
  const query = useDeckView((s) => s.query)

  const stateLabel = STATE_FILTERS.find((f) => f.value === stateFilter)?.key
  const filtered = stateFilter !== "all" || tagFilter !== null || query.trim().length > 0

  return (
    <div className="flex items-center gap-2.5">
      <div className="relative shrink-0">
        <AppIcon
          name="common/search"
          size={13}
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-faded"
        />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={fc("SearchCardsPlaceholder")}
          aria-label={fc("SearchCardsPlaceholder")}
          className="h-8 w-[220px] rounded-md border border-line bg-surface pr-2 pl-[30px] text-body-extra-small text-text-primary outline-none placeholder:text-text-faded focus:border-brand"
        />
      </div>

      {stateLabel ? (
        <FilterChip label={fc("DeckFilterStateFormat", { 0: fc(stateLabel) })} onRemove={clearStateFilter} />
      ) : null}
      {tagFilter ? (
        <FilterChip label={fc("DeckFilterTagFormat", { 0: tagFilter })} onRemove={clearTagFilter} />
      ) : null}

      <Menu>
        <MenuTrigger asChild>
          {/* The dashed outline is a plain CSS border rather than the desktop's
              stroked rectangle; at 1px the dash rhythm is visually the same and it
              stays in step with the pill radius. */}
          <button
            type="button"
            className="flex h-[26px] shrink-0 items-center gap-[5px] rounded-full border border-dashed border-text-disabled px-2.5 text-caption text-text-tertiary hover:bg-surface-subtle"
          >
            <AppIcon name="common/plus" size={11} />
            {fc("AddFilter")}
          </button>
        </MenuTrigger>
        <MenuContent align="start">
          <MenuSubMenu label={fc("FilterByState")}>
            {STATE_FILTERS.map((filter) => (
              <MenuItem key={filter.value} onSelect={() => setStateFilter(filter.value)}>
                {fc(filter.key)}
              </MenuItem>
            ))}
          </MenuSubMenu>
          {knownTags.length > 0 ? (
            <MenuSubMenu label={fc("FilterByTag")}>
              {knownTags.map((tag) => (
                <MenuItem key={tag} onSelect={() => setTagFilter(tag)}>
                  {tag}
                </MenuItem>
              ))}
            </MenuSubMenu>
          ) : null}
        </MenuContent>
      </Menu>

      <div className="flex-1" />

      {filtered && totalCount > 0 ? (
        <span className="shrink-0 text-caption text-text-tertiary">
          {fc("DeckFilteredCountFormat", { 0: totalCount })}
        </span>
      ) : null}
    </div>
  )
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="flex h-[26px] shrink-0 items-center gap-1 rounded-full bg-brand-subtle px-2.5 text-caption text-brand">
      {label}
      <button type="button" onClick={onRemove} aria-label={label} className="rounded-sm p-0.5 hover:bg-brand/15">
        <AppIcon name="common/x" size={10} />
      </button>
    </span>
  )
}
