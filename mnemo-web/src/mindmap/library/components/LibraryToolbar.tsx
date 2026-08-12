import { AppIcon } from "@/components/icon/AppIcon"
import type { IconName } from "@/components/icon/icon-registry"
import { Button } from "@/components/ui/button"
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { SORT_MODES, type LibraryView } from "../shelf"
import { useLibraryView } from "../store"
import { SORT_LABEL_KEYS } from "./labels"

const VIEWS: readonly { id: LibraryView; icon: IconName; labelKey: string }[] = [
  { id: "grid", icon: "common/layout-grid", labelKey: "ViewGrid" },
  { id: "list", icon: "list", labelKey: "ViewList" },
]

/** What is below, how many of it, and how it is arranged. */
export function LibraryToolbar({ label, count, searchPlaceholder }: { label: string; count: number; searchPlaceholder: string }) {
  const t = useT()
  const mm = (key: string) => t("Mindmap", key)

  const search = useLibraryView((state) => state.search)
  const setSearch = useLibraryView((state) => state.setSearch)
  const sort = useLibraryView((state) => state.sort)
  const setSort = useLibraryView((state) => state.setSort)
  const view = useLibraryView((state) => state.view)
  const setView = useLibraryView((state) => state.setView)

  return (
    <div className="flex items-center gap-2">
      <span className="text-[13px] font-semibold text-ink">{label}</span>
      <span className="font-mono text-[11px] text-ink-3">{count}</span>

      <div className="ml-auto flex h-8 w-[220px] shrink-0 items-center gap-1.5 rounded-lg bg-canvas-sunken px-2.5 focus-within:shadow-[0_0_0_1px_var(--line)]">
        <AppIcon name="search" size={14} strokeWidth={1.7} className="shrink-0 text-ink-icon" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-3 focus:outline-none"
        />
      </div>

      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" trailing={<AppIcon name="chevron-down" size={13} strokeWidth={1.7} />}>
            {mm("SortLabelFormat").replace("{0}", mm(SORT_LABEL_KEYS[sort]))}
          </Button>
        </MenuTrigger>
        <MenuContent align="end">
          {SORT_MODES.map((mode) => (
            <MenuItem key={mode} onSelect={() => setSort(mode)}>
              {/* The tick sits in a reserved slot so labels stay aligned whether or not the mode is
                  the active one. */}
              <span className="flex items-center gap-2.5">
                <span className="grid w-3.5 shrink-0 place-items-center">
                  {mode === sort ? <AppIcon name="check" size={12} /> : null}
                </span>
                {mm(SORT_LABEL_KEYS[mode])}
              </span>
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>

      <div className="flex h-8 shrink-0 items-center gap-0.5 rounded-lg bg-canvas-sunken p-0.5">
        {VIEWS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setView(option.id)}
            aria-label={mm(option.labelKey)}
            title={mm(option.labelKey)}
            aria-pressed={view === option.id}
            className={cn(
              "grid size-7 place-items-center rounded-md transition-colors",
              view === option.id
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
