import { AppIcon } from "@/components/icon/AppIcon"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import type { CardTypeDraft } from "../card-types"

/**
 * The list of card types. A row is selected on click and deleted from its context menu, which is
 * offered only for a type nothing would break over: one the app ships with cannot go, and one that
 * still holds material would take that material with it.
 */
export function CardTypeSidebar({
  drafts,
  selectedKey,
  onSelect,
  onCreate,
  onDelete,
}: {
  drafts: CardTypeDraft[]
  selectedKey: string | null
  onSelect: (key: string) => void
  onCreate: () => void
  onDelete: (key: string) => void
}) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

  return (
    <div className="flex w-[210px] shrink-0 flex-col border-r border-line-soft bg-canvas-sunken/60 px-2.5 pb-3 pt-3.5">
      <div className="px-1.5 pb-2 text-[12px] text-ink-3">{fc("CardTypesTitle")}</div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {drafts.map((draft) => (
          <CardTypeRow
            key={draft.key}
            draft={draft}
            selected={draft.key === selectedKey}
            useLabel={fc("CardTypesUseCountFormat", { 0: draft.factCount })}
            onSelect={() => onSelect(draft.key)}
            onDelete={() => onDelete(draft.key)}
          />
        ))}

        <button
          type="button"
          onClick={onCreate}
          className="mt-1 flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[13px] text-ink-3 transition-colors hover:bg-frame-hover hover:text-ink"
        >
          <AppIcon name="common/plus" size={12} />
          <span>{fc("CardTypesNewType")}</span>
        </button>
      </div>
    </div>
  )
}

function CardTypeRow({
  draft,
  selected,
  useLabel,
  onSelect,
  onDelete,
}: {
  draft: CardTypeDraft
  selected: boolean
  useLabel: string
  onSelect: () => void
  onDelete: () => void
}) {
  const t = useT()

  const canDelete = !draft.isBuiltIn && draft.factCount === 0

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="option"
          aria-selected={selected}
          tabIndex={0}
          // On press rather than click, and for the right button too: opening a row's menu selects
          // it first, or Delete would act on one type while the pane shows another.
          onPointerDown={onSelect}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              onSelect()
            }
          }}
          className={cn(
            "flex h-8 shrink-0 cursor-pointer items-center rounded-md px-2 transition-colors",
            !selected && "hover:bg-frame-hover",
            selected && "bg-frame-active",
          )}
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13px]",
              selected ? "font-medium text-ink" : "text-ink-2",
            )}
          >
            {draft.name}
          </span>
          <span className="ml-2 shrink-0 text-[11px] tabular-nums text-ink-3" title={useLabel}>
            {draft.factCount}
          </span>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem icon="common/trash" danger disabled={!canDelete} onSelect={onDelete}>
          {t("Common", "Delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
