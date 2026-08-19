import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@/components/ui/menu"
import { useT } from "@/i18n/useT"

import { FILTER_KINDS, kindLabel } from "../kinds"

/** The value the kind filter carries when nothing is filtered out. */
const ALL = ""

/** Search, a filter by kind, and the one action that applies to the whole list. */
export function TrashToolbar({
  query,
  onQueryChange,
  kind,
  onKindChange,
  onEmpty,
  emptyDisabled,
}: {
  query: string
  onQueryChange: (next: string) => void
  kind: string | null
  onKindChange: (next: string | null) => void
  onEmpty: () => void
  emptyDisabled: boolean
}) {
  const t = useT()

  return (
    <div className="mt-6 flex items-center gap-2">
      <div className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-canvas-sunken px-2.5 focus-within:shadow-[0_0_0_1px_var(--line)]">
        <AppIcon name="search" size={14} strokeWidth={1.7} className="shrink-0 text-ink-icon" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t("Trash", "SearchPlaceholder")}
          aria-label={t("Trash", "SearchPlaceholder")}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
        />
      </div>

      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="md" icon={<AppIcon name="list-filter" size={14} strokeWidth={1.7} />}>
            {kind ? kindLabel(kind, t) : t("Trash", "AllKinds")}
          </Button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuRadioGroup value={kind ?? ALL} onValueChange={(next) => onKindChange(next === ALL ? null : next)}>
            <MenuRadioItem value={ALL}>{t("Trash", "AllKinds")}</MenuRadioItem>
            {FILTER_KINDS.map((value) => (
              <MenuRadioItem key={value} value={value}>
                {kindLabel(value, t)}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuContent>
      </Menu>

      <Button
        variant="danger"
        size="md"
        disabled={emptyDisabled}
        onClick={onEmpty}
        icon={<AppIcon name="trash-2" size={14} strokeWidth={1.7} />}
      >
        {t("Trash", "EmptyTrash")}
      </Button>
    </div>
  )
}
