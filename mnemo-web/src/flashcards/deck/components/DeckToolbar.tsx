import { AppIcon } from "@/components/icon/AppIcon"
import { Menu, MenuContent, MenuItem, MenuSubMenu, MenuTrigger } from "@/components/ui/menu"
import { useT } from "@/i18n/useT"

import {
  CARD_TYPE_KEY,
  CARD_TYPES,
  LAPSES_FILTER_KEY,
  LAPSES_FILTERS,
  STATE_FILTER_KEY,
  STATE_FILTERS,
} from "../filters"
import { useDeckView } from "../store"

/** Search box, the state chip strip, the add-filter menu and the result count. */
export function DeckToolbar({ knownTags, totalCount }: { knownTags: string[]; totalCount: number }) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

  const search = useDeckView((s) => s.search)
  const setSearch = useDeckView((s) => s.setSearch)
  const stateFilter = useDeckView((s) => s.stateFilter)
  const tagFilter = useDeckView((s) => s.tagFilter)
  const typeFilter = useDeckView((s) => s.typeFilter)
  const lapsesFilter = useDeckView((s) => s.lapsesFilter)
  const setStateFilter = useDeckView((s) => s.setStateFilter)
  const setTagFilter = useDeckView((s) => s.setTagFilter)
  const setTypeFilter = useDeckView((s) => s.setTypeFilter)
  const setLapsesFilter = useDeckView((s) => s.setLapsesFilter)
  const clearTagFilter = useDeckView((s) => s.clearTagFilter)
  const clearFilters = useDeckView((s) => s.clearFilters)
  const query = useDeckView((s) => s.query)

  const filtered =
    stateFilter !== "all" ||
    tagFilter !== null ||
    typeFilter !== null ||
    lapsesFilter !== "any" ||
    query.trim().length > 0

  return (
    // Wraps rather than scrolls: the strip is six chips plus the search box, which
    // is wider than the table at a narrow window, and a filter you have to scroll
    // sideways to reach may as well not be there.
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
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

      <div className="flex shrink-0 items-center gap-1">
        {STATE_FILTERS.map((state) => (
          <StateChip
            key={state}
            label={fc(STATE_FILTER_KEY[state])}
            active={state === stateFilter}
            onSelect={() => setStateFilter(state)}
          />
        ))}
      </div>

      {typeFilter ? (
        <FilterChip
          label={fc("DeckFilterTypeFormat", { 0: fc(CARD_TYPE_KEY[typeFilter]) })}
          onRemove={() => setTypeFilter(null)}
        />
      ) : null}
      {/* Bare label, unlike the others: the lapse options are whole phrases
          already, so a "Forgotten:" prefix only stutters. */}
      {lapsesFilter !== "any" ? (
        <FilterChip label={fc(LAPSES_FILTER_KEY[lapsesFilter])} onRemove={() => setLapsesFilter("any")} />
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
          <MenuSubMenu label={fc("FilterByType")}>
            {CARD_TYPES.map((type) => (
              <MenuItem key={type} onSelect={() => setTypeFilter(type)}>
                <Checkable label={fc(CARD_TYPE_KEY[type])} active={type === typeFilter} />
              </MenuItem>
            ))}
          </MenuSubMenu>
          <MenuSubMenu label={fc("FilterByLapses")}>
            {LAPSES_FILTERS.map((lapses) => (
              <MenuItem key={lapses} onSelect={() => setLapsesFilter(lapses)}>
                <Checkable label={fc(LAPSES_FILTER_KEY[lapses])} active={lapses === lapsesFilter} />
              </MenuItem>
            ))}
          </MenuSubMenu>
          {knownTags.length > 0 ? (
            <MenuSubMenu label={fc("FilterByTag")}>
              {knownTags.map((tag) => (
                <MenuItem key={tag} onSelect={() => setTagFilter(tag)}>
                  <Checkable label={tag} active={tag === tagFilter} />
                </MenuItem>
              ))}
            </MenuSubMenu>
          ) : null}
        </MenuContent>
      </Menu>

      {/* ml-auto rather than a spacer element, so the pair still sits right on a
          line of its own once the strip wraps. */}
      <div className="ml-auto flex items-center gap-2.5">
        {filtered ? (
          <button
            type="button"
            onClick={clearFilters}
            className="shrink-0 rounded-md px-1.5 py-0.5 text-caption text-text-tertiary hover:text-text-primary"
          >
            {fc("ClearFilters")}
          </button>
        ) : null}

        {filtered && totalCount > 0 ? (
          <span className="shrink-0 text-caption text-text-tertiary">
            {fc("DeckFilteredCountFormat", { 0: totalCount })}
          </span>
        ) : null}
      </div>
    </div>
  )
}

/**
 * One state in the strip. Pressed rather than removable: the states are exclusive
 * and All is always available, so there is nothing an x could do that picking a
 * different chip does not.
 */
function StateChip({ label, active, onSelect }: { label: string; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={
        active
          ? "flex h-[26px] shrink-0 items-center rounded-full bg-brand-subtle px-2.5 text-caption text-brand"
          : "flex h-[26px] shrink-0 items-center rounded-full px-2.5 text-caption text-text-tertiary hover:bg-surface-subtle"
      }
    >
      {label}
    </button>
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

/** The tick sits in a reserved slot so labels stay aligned whether or not the option is the active one. */
function Checkable({ label, active }: { label: string; active: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid w-3.5 shrink-0 place-items-center">
        {active ? <AppIcon name="common/check" size={12} /> : null}
      </span>
      {label}
    </span>
  )
}
