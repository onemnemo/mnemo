import { AppIcon } from "@/components/icon/AppIcon"
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu"
import { useT } from "@/i18n/useT"

import { useLibraryView } from "../store"
import { SORT_MODES, type SortMode } from "../tree"

const SORT_LABEL_KEYS: Record<SortMode, string> = {
  due: "SortDue",
  name: "SortName",
  retention: "SortRetention",
  cards: "SortCards",
}

/** Filter box, sort picker and the expand/collapse-all toggle. */
export function LibraryToolbar({ onToggleAll }: { onToggleAll: () => void }) {
  const t = useT()
  const search = useLibraryView((s) => s.search)
  const setSearch = useLibraryView((s) => s.setSearch)
  const sort = useLibraryView((s) => s.sort)
  const setSort = useLibraryView((s) => s.setSort)
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <AppIcon
          name="common/search"
          size={12}
          className="pointer-events-none absolute top-1/2 left-[9px] -translate-y-1/2 text-text-faded"
        />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={fc("FilterDecks")}
          aria-label={fc("FilterDecks")}
          className="h-7 w-[200px] rounded-md border border-line bg-surface pr-2 pl-[26px] text-body-extra-small text-text-primary outline-none placeholder:text-text-faded focus:border-brand"
        />
      </div>

      <div className="flex-1" />

      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            title={fc("SortLabel")}
            className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-body-extra-small text-text-tertiary hover:bg-surface-subtle"
          >
            {fc("SortLabelFormat", { 0: fc(SORT_LABEL_KEYS[sort]) })}
            <AppIcon name="common/chevron-down" size={10} className="text-text-faded" />
          </button>
        </MenuTrigger>
        <MenuContent align="end">
          {SORT_MODES.map((mode) => (
            <MenuItem key={mode} onSelect={() => setSort(mode)}>
              {/* The tick sits in a reserved slot so labels stay aligned whether or
                  not the mode is the active one. */}
              <span className="flex items-center gap-2.5">
                <span className="grid w-3.5 shrink-0 place-items-center">
                  {mode === sort ? <AppIcon name="common/check" size={12} /> : null}
                </span>
                {fc(SORT_LABEL_KEYS[mode])}
              </span>
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>

      <button
        type="button"
        onClick={onToggleAll}
        title={fc("ExpandCollapseAll")}
        aria-label={fc("ExpandCollapseAll")}
        className="grid size-7 place-items-center rounded-md text-text-tertiary hover:bg-surface-subtle"
      >
        <AppIcon name="common/chevrons-up-down" size={12} />
      </button>
    </div>
  )
}
