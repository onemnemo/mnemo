import { AppIcon } from "@/components/icon/AppIcon"
import type { IconName } from "@/components/icon/icon-registry"
import { Button } from "@/components/ui/button"
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { useLibraryView, type LibraryLayout } from "../store"
import { SORT_MODES, type SortMode } from "../tree"

const SORT_LABEL_KEYS: Record<SortMode, string> = {
  due: "SortDue",
  name: "SortName",
  retention: "SortRetention",
  cards: "SortCards",
}

const LAYOUTS: readonly { id: LibraryLayout; icon: IconName; labelKey: string }[] = [
  { id: "list", icon: "list", labelKey: "ViewList" },
  { id: "grid", icon: "layout-grid", labelKey: "ViewGrid" },
]

/** Filter box, the sort picker, expand/collapse all, and the list/grid switch. */
export function LibraryToolbar({ onToggleAll }: { onToggleAll: () => void }) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

  const search = useLibraryView((s) => s.search)
  const setSearch = useLibraryView((s) => s.setSearch)
  const sort = useLibraryView((s) => s.sort)
  const setSort = useLibraryView((s) => s.setSort)
  const layout = useLibraryView((s) => s.layout)
  const setLayout = useLibraryView((s) => s.setLayout)

  return (
    <div className="mt-7 flex items-center gap-2">
      <div className="flex h-8 w-[240px] shrink-0 items-center gap-1.5 rounded-lg bg-canvas-sunken px-2.5 focus-within:shadow-[0_0_0_1px_var(--line)]">
        <AppIcon name="search" size={14} strokeWidth={1.7} className="shrink-0 text-ink-icon" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={fc("FilterDecks")}
          aria-label={fc("FilterDecks")}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-3 focus:outline-none"
        />
      </div>

      <div className="flex-1" />

      {/* Not in the prototype, and kept: a tree of folders you cannot close in one
          move is worse than the button is loud. */}
      {layout === "list" ? (
        <button
          type="button"
          onClick={onToggleAll}
          title={fc("ExpandCollapseAll")}
          aria-label={fc("ExpandCollapseAll")}
          className="grid size-8 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-frame-hover hover:text-ink"
        >
          <AppIcon name="common/chevrons-up-down" size={14} />
        </button>
      ) : null}

      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" title={fc("SortLabel")} trailing={<AppIcon name="chevron-down" size={13} strokeWidth={1.7} />}>
            {fc("SortLabelFormat", { 0: fc(SORT_LABEL_KEYS[sort]) })}
          </Button>
        </MenuTrigger>
        <MenuContent align="end">
          {SORT_MODES.map((mode) => (
            <MenuItem key={mode} onSelect={() => setSort(mode)}>
              {/* The tick sits in a reserved slot so labels stay aligned whether or
                  not the mode is the active one. */}
              <span className="flex items-center gap-2.5">
                <span className="grid w-3.5 shrink-0 place-items-center">
                  {mode === sort ? <AppIcon name="check" size={12} /> : null}
                </span>
                {fc(SORT_LABEL_KEYS[mode])}
              </span>
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>

      <div className="flex h-8 shrink-0 items-center gap-0.5 rounded-lg bg-canvas-sunken p-0.5">
        {LAYOUTS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setLayout(option.id)}
            aria-label={fc(option.labelKey)}
            title={fc(option.labelKey)}
            aria-pressed={layout === option.id}
            className={cn(
              "grid size-7 place-items-center rounded-md transition-colors",
              layout === option.id
                ? "bg-canvas text-ink shadow-[0_1px_2px_oklch(0_0_0/0.07)]"
                : "text-ink-3 hover:text-ink-2",
            )}
          >
            <AppIcon name={option.icon} size={16} strokeWidth={1.7} />
          </button>
        ))}
      </div>
    </div>
  )
}
