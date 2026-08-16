import { useEffect, useRef } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import type { PresetDraft } from "../presets"

/**
 * The preset list. A row is selected on click, renamed on double-click or from its context
 * menu, and deleted from that menu only when nothing would break - which is what the desktop
 * offers, down to there being no inline delete button.
 */
export function PresetSidebar({
  drafts,
  selectedKey,
  renamingKey,
  editingNote,
  onSelect,
  onBeginRename,
  onCommitRename,
  onCancelRename,
  onCreate,
  onDelete,
}: {
  drafts: PresetDraft[]
  selectedKey: string | null
  renamingKey: string | null
  editingNote: string
  onSelect: (key: string) => void
  onBeginRename: (key: string) => void
  onCommitRename: (key: string, name: string) => void
  onCancelRename: () => void
  onCreate: () => void
  onDelete: (key: string) => void
}) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

  return (
    <div className="flex w-[210px] shrink-0 flex-col border-r border-line-soft bg-canvas-sunken/60 px-2.5 pb-3 pt-3.5">
      <div className="px-1.5 pb-2 text-[12px] text-ink-3">{fc("ReviewSettingsPresetsLabel")}</div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {drafts.map((draft) => (
          <PresetRow
            key={draft.key}
            draft={draft}
            selected={draft.key === selectedKey}
            renaming={draft.key === renamingKey}
            deckCountLabel={
              draft.deckCount === 1
                ? fc("ReviewSettingsDeckCountSingular")
                : fc("ReviewSettingsDeckCountFormat", { 0: draft.deckCount })
            }
            onSelect={() => onSelect(draft.key)}
            onBeginRename={() => onBeginRename(draft.key)}
            onCommitRename={(name) => onCommitRename(draft.key, name)}
            onCancelRename={onCancelRename}
            onDelete={() => onDelete(draft.key)}
          />
        ))}

        <button
          type="button"
          onClick={onCreate}
          className="mt-1 flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[13px] text-ink-3 transition-colors hover:bg-frame-hover hover:text-ink"
        >
          <AppIcon name="common/plus" size={12} />
          <span>{fc("ReviewSettingsNewPreset")}</span>
        </button>
      </div>

      {editingNote ? (
        <p className="mt-2.5 px-1.5 text-[11px] leading-[15px] text-ink-3">{editingNote}</p>
      ) : null}
    </div>
  )
}

function PresetRow({
  draft,
  selected,
  renaming,
  deckCountLabel,
  onSelect,
  onBeginRename,
  onCommitRename,
  onCancelRename,
  onDelete,
}: {
  draft: PresetDraft
  selected: boolean
  renaming: boolean
  deckCountLabel: string
  onSelect: () => void
  onBeginRename: () => void
  onCommitRename: (name: string) => void
  onCancelRename: () => void
  onDelete: () => void
}) {
  const t = useT()
  const fc = (key: string) => t("Flashcards", key)

  // Standard is the seeded preset the server refuses to drop, and a preset a deck still points
  // at would orphan it - the same two conditions the desktop greys the menu item on.
  const canDelete = !draft.isStandard && draft.deckCount === 0

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="option"
          aria-selected={selected}
          tabIndex={0}
          // On press rather than click, and so for the right button too: opening a row's context
          // menu selects that row, or Delete would act on one preset while the pane shows another.
          onPointerDown={() => !renaming && onSelect()}
          onDoubleClick={() => !renaming && onBeginRename()}
          onKeyDown={(event) => {
            if (renaming) return
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
          {renaming ? (
            <RenameBox
              initial={draft.name}
              label={fc("RenameDeck")}
              onCommit={onCommitRename}
              onCancel={onCancelRename}
            />
          ) : (
            <>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-[13px]",
                  selected ? "font-medium text-ink" : "text-ink-2",
                )}
              >
                {draft.name}
              </span>
              <span className="ml-2 shrink-0 text-[11px] tabular-nums text-ink-3">{deckCountLabel}</span>
            </>
          )}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem icon="flyout/rename" onSelect={onBeginRename}>
          {fc("RenameDeck")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem icon="common/trash" danger disabled={!canDelete} onSelect={onDelete}>
          {fc("ReviewSettingsDelete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/**
 * The inline rename box. Marked as an inline editor so the dialog lets Escape cancel the rename
 * instead of closing everything.
 */
function RenameBox({
  initial,
  label,
  onCommit,
  onCancel,
}: {
  initial: string
  label: string
  onCommit: (name: string) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  // Whether this box has already resolved, so the blur that follows Enter or Escape does not
  // commit a second time.
  const settled = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  return (
    <input
      ref={ref}
      data-inline-editor
      defaultValue={initial}
      aria-label={label}
      spellCheck={false}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onBlur={(event) => {
        if (settled.current) return
        settled.current = true
        onCommit(event.target.value)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          settled.current = true
          onCommit(event.currentTarget.value)
        }
        if (event.key === "Escape") {
          settled.current = true
          onCancel()
        }
      }}
      className="h-6 w-full rounded-md bg-transparent px-1 text-[13px] text-ink shadow-[0_0_0_1px_var(--line)] outline-none focus:shadow-[0_0_0_1.5px_var(--solid)]"
    />
  )
}
