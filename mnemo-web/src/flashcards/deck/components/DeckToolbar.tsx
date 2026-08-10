import { AppIcon } from "@/components/icon/AppIcon"
import { Menu, MenuContent, MenuItem, MenuSubMenu, MenuTrigger } from "@/components/ui/menu"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import {
  CARD_TYPE_KEY,
  CARD_TYPES,
  LAPSES_FILTERS,
  LAPSES_FILTER_KEY,
  LAPSES_TOKEN_KEY,
  STATE_FILTERS,
  STATE_FILTER_KEY,
} from "../filters"
import { useDeckView } from "../store"

/**
 * Search, the state chips, and the dimensions that sit behind a menu.
 *
 * State lives on chips because it is the filter you use constantly, and a single
 * "Filter" button hides both the options and whether one is on. The dimensions you
 * reach for occasionally keep the menu: they are long lists, and as chips they
 * would drown the strip that matters.
 */
export function DeckToolbar({ knownTags }: { knownTags: string[] }) {
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
    <div className="mt-6 flex flex-wrap items-center gap-2">
      <div className="flex h-8 w-[240px] shrink-0 items-center gap-1.5 rounded-lg bg-canvas-sunken px-2.5 focus-within:shadow-[0_0_0_1px_var(--line)]">
        <AppIcon name="search" size={14} strokeWidth={1.7} className="shrink-0 text-ink-icon" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={fc("SearchCardsPlaceholder")}
          aria-label={fc("SearchCardsPlaceholder")}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-3 focus:outline-none"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex items-center gap-1">
          {STATE_FILTERS.map((state) => (
            <StateChip
              key={state}
              label={fc(STATE_FILTER_KEY[state])}
              flag={state === "flagged"}
              active={state === stateFilter}
              onSelect={() => setStateFilter(state)}
            />
          ))}
        </div>

        <span className="mx-0.5 h-5 w-px bg-line-soft" />

        <Menu>
          <MenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12.5px] transition-colors",
                "text-ink-2 hover:bg-frame-hover hover:text-ink aria-expanded:bg-frame-hover aria-expanded:text-ink",
              )}
            >
              <AppIcon name="list-filter" size={14} strokeWidth={1.7} />
              {fc("AddFilter")}
            </button>
          </MenuTrigger>
          <MenuContent align="start">
            {knownTags.length > 0 ? (
              <MenuSubMenu label={fc("FilterByTag")} icon="tag" hint={tagFilter ?? undefined}>
                {knownTags.map((tag) => (
                  <MenuItem key={tag} onSelect={() => (tag === tagFilter ? clearTagFilter() : setTagFilter(tag))}>
                    <Checkable label={tag} active={tag === tagFilter} />
                  </MenuItem>
                ))}
              </MenuSubMenu>
            ) : null}
            <MenuSubMenu
              label={fc("FilterByType")}
              icon="type"
              hint={typeFilter ? fc(CARD_TYPE_KEY[typeFilter]) : undefined}
            >
              {CARD_TYPES.map((type) => (
                <MenuItem key={type} onSelect={() => setTypeFilter(type === typeFilter ? null : type)}>
                  <Checkable label={fc(CARD_TYPE_KEY[type])} active={type === typeFilter} />
                </MenuItem>
              ))}
            </MenuSubMenu>
            <MenuSubMenu
              label={fc("FilterByLapses")}
              icon="repeat-2"
              hint={lapsesFilter === "any" ? undefined : fc(LAPSES_TOKEN_KEY[lapsesFilter])}
            >
              {LAPSES_FILTERS.map((lapses) => (
                <MenuItem
                  key={lapses}
                  onSelect={() => setLapsesFilter(lapses === lapsesFilter ? "any" : lapses)}
                >
                  <Checkable label={fc(LAPSES_FILTER_KEY[lapses])} active={lapses === lapsesFilter} />
                </MenuItem>
              ))}
            </MenuSubMenu>
          </MenuContent>
        </Menu>

        {tagFilter ? <Token label={fc("FilterByTag")} value={tagFilter} onClear={clearTagFilter} /> : null}
        {typeFilter ? (
          <Token
            label={fc("FilterByType")}
            value={fc(CARD_TYPE_KEY[typeFilter])}
            onClear={() => setTypeFilter(null)}
          />
        ) : null}
        {lapsesFilter !== "any" ? (
          <Token
            label={fc("FilterByLapses")}
            value={fc(LAPSES_TOKEN_KEY[lapsesFilter])}
            onClear={() => setLapsesFilter("any")}
          />
        ) : null}

        {filtered ? (
          <button
            type="button"
            onClick={clearFilters}
            className="h-7 shrink-0 rounded-md px-2 text-[12.5px] text-ink-3 transition-colors hover:bg-frame-hover hover:text-ink"
          >
            {fc("ClearFilters")}
          </button>
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
function StateChip({
  label,
  flag,
  active,
  onSelect,
}: {
  label: string
  /** Flagged is the one state with a mark of its own, and the row shows the same one. */
  flag: boolean
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12.5px] transition-colors",
        active ? "bg-frame-active font-medium text-ink" : "text-ink-2 hover:bg-frame-hover hover:text-ink",
      )}
    >
      {/* Filled only while this chip is the active filter, matching the row's own flag. */}
      {flag ? <AppIcon name="common/flag" size={12} className={active ? "[&>svg]:fill-current" : undefined} /> : null}
      {label}
    </button>
  )
}

/** An active filter from the menu, named by its dimension so the chips stay readable. */
function Token({ label, value, onClear }: { label: string; value: string; onClear: () => void }) {
  return (
    <span className="flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-frame-active pr-1 pl-2 text-[12.5px]">
      <span className="text-ink-3">{label}</span>
      <span className="font-medium text-ink">{value}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={label}
        className="grid size-5 place-items-center rounded text-ink-3 transition-colors hover:bg-canvas hover:text-ink"
      >
        <AppIcon name="x" size={11} strokeWidth={2.2} />
      </button>
    </span>
  )
}

/** The tick sits in a reserved slot so labels stay aligned whether or not the option is the active one. */
function Checkable({ label, active }: { label: string; active: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid w-3.5 shrink-0 place-items-center">
        {active ? <AppIcon name="check" size={12} /> : null}
      </span>
      {label}
    </span>
  )
}
