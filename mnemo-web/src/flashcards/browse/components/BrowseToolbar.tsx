import type { DeckOption } from "@/flashcards/editor/deck-options"
import type { CardTypeDto } from "@/api/types"
import { AppIcon } from "@/components/icon/AppIcon"
import { Menu, MenuContent, MenuItem, MenuSubMenu, MenuTrigger } from "@/components/ui/menu"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import {
  LAPSES_FILTERS,
  LAPSES_FILTER_KEY,
  LAPSES_TOKEN_KEY,
  STATE_FILTERS,
  STATE_FILTER_KEY,
} from "../../deck/filters"
import { useBrowseView } from "../store"

/**
 * Search, the state chips, and the dimensions that sit behind a menu - generalized from
 * deck/components/DeckToolbar.tsx for the collection-wide browser. Type is the real,
 * user-defined card type from GET /api/card-types rather than the deck table's classic/cloze
 * split, and Deck is new: it is the one dimension a single deck's own table never needed,
 * since the deck itself already narrowed it.
 */
export function BrowseToolbar({
  knownTags,
  deckOptions,
  cardTypes,
}: {
  knownTags: string[]
  deckOptions: DeckOption[]
  cardTypes: CardTypeDto[]
}) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

  const search = useBrowseView((s) => s.search)
  const setSearch = useBrowseView((s) => s.setSearch)
  const stateFilter = useBrowseView((s) => s.stateFilter)
  const tagFilter = useBrowseView((s) => s.tagFilter)
  const deckFilter = useBrowseView((s) => s.deckFilter)
  const cardTypeFilter = useBrowseView((s) => s.cardTypeFilter)
  const lapsesFilter = useBrowseView((s) => s.lapsesFilter)
  const setStateFilter = useBrowseView((s) => s.setStateFilter)
  const setTagFilter = useBrowseView((s) => s.setTagFilter)
  const setDeckFilter = useBrowseView((s) => s.setDeckFilter)
  const setCardTypeFilter = useBrowseView((s) => s.setCardTypeFilter)
  const setLapsesFilter = useBrowseView((s) => s.setLapsesFilter)
  const clearTagFilter = useBrowseView((s) => s.clearTagFilter)
  const clearDeckFilter = useBrowseView((s) => s.clearDeckFilter)
  const clearCardTypeFilter = useBrowseView((s) => s.clearCardTypeFilter)
  const clearFilters = useBrowseView((s) => s.clearFilters)
  const query = useBrowseView((s) => s.query)

  const deckLabel = deckOptions.find((option) => option.id === deckFilter)?.pathLabel ?? undefined
  const cardTypeLabel = cardTypes.find((type) => type.id === cardTypeFilter)?.name ?? undefined

  const filtered =
    stateFilter !== "all" ||
    tagFilter !== null ||
    deckFilter !== null ||
    cardTypeFilter !== null ||
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
            <MenuSubMenu label={fc("ColDeck")} icon="common/folder" hint={deckLabel}>
              {deckOptions.map((option) => (
                <MenuItem
                  key={option.id}
                  onSelect={() => (option.id === deckFilter ? clearDeckFilter() : setDeckFilter(option.id))}
                >
                  <Checkable label={option.pathLabel} active={option.id === deckFilter} />
                </MenuItem>
              ))}
            </MenuSubMenu>
            {knownTags.length > 0 ? (
              <MenuSubMenu label={fc("FilterByTag")} icon="tag" hint={tagFilter ?? undefined}>
                {knownTags.map((tag) => (
                  <MenuItem key={tag} onSelect={() => (tag === tagFilter ? clearTagFilter() : setTagFilter(tag))}>
                    <Checkable label={tag} active={tag === tagFilter} />
                  </MenuItem>
                ))}
              </MenuSubMenu>
            ) : null}
            {cardTypes.length > 0 ? (
              <MenuSubMenu label={fc("FilterByType")} icon="type" hint={cardTypeLabel}>
                {cardTypes.map((type) => (
                  <MenuItem
                    key={type.id}
                    onSelect={() => (type.id === cardTypeFilter ? clearCardTypeFilter() : setCardTypeFilter(type.id))}
                  >
                    <Checkable label={type.name} active={type.id === cardTypeFilter} />
                  </MenuItem>
                ))}
              </MenuSubMenu>
            ) : null}
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

        {deckFilter && deckLabel ? <Token label={fc("ColDeck")} value={deckLabel} onClear={clearDeckFilter} /> : null}
        {tagFilter ? <Token label={fc("FilterByTag")} value={tagFilter} onClear={clearTagFilter} /> : null}
        {cardTypeFilter && cardTypeLabel ? (
          <Token label={fc("FilterByType")} value={cardTypeLabel} onClear={clearCardTypeFilter} />
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

function StateChip({
  label,
  flag,
  active,
  onSelect,
}: {
  label: string
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
      {flag ? <AppIcon name="common/flag" size={12} className={active ? "[&>svg]:fill-current" : undefined} /> : null}
      {label}
    </button>
  )
}

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
