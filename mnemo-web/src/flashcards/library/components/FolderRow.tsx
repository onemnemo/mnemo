import { useEffect, useRef, useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"
import { dialog } from "@/stores/dialog"

import { useDeleteFolder, useSaveFolder } from "../../api"
import type { FolderRowModel } from "../tree"
import { DEPTH_INDENT, METRIC_CLASS, ROW_GRID } from "./rowLayout"

/** A folder in the library table: its own row, plus its subtree's totals. */
export function FolderRow({ row, onToggle }: { row: FolderRowModel; onToggle: (id: string) => void }) {
  const t = useT()
  const saveFolder = useSaveFolder()
  const deleteFolder = useDeleteFolder()
  const [editing, setEditing] = useState(false)
  const { folder, counts } = row
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

  const commitRename = async (name: string) => {
    setEditing(false)
    const trimmed = name.trim()
    if (!trimmed || trimmed === folder.name) return
    await saveFolder.mutateAsync({ id: folder.id, name: trimmed, parentId: folder.parentId, order: folder.order })
  }

  const remove = async () => {
    const ok = await dialog.confirm({
      title: fc("DeleteFolder"),
      message: fc("DeleteFolderConfirm", { 0: folder.name }),
      destructive: true,
      confirmLabel: fc("DeleteFolder"),
      cancelLabel: t("Common", "Cancel"),
    })
    if (ok) await deleteFolder.mutateAsync(folder.id)
  }

  return (
    <div
      role="row"
      tabIndex={0}
      onClick={() => !editing && onToggle(folder.id)}
      onDoubleClick={() => setEditing(true)}
      onKeyDown={(event) => {
        if (editing) return
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onToggle(folder.id)
        }
      }}
      className={cn(
        ROW_GRID,
        "group h-[38px] cursor-pointer border-b border-divider-subtle outline-none",
        "hover:bg-[var(--widget-background-hover)] focus-visible:bg-[var(--widget-background-hover)]",
      )}
    >
      <div className="flex min-w-0 items-center gap-2" style={{ marginLeft: row.depth * DEPTH_INDENT }}>
        <AppIcon name={row.expanded ? "common/chevron-down" : "common/chevron-right"} size={9} className="text-text-faded" />
        <AppIcon name="common/folder" size={14} className="text-text-faded" />
        {editing ? (
          <FolderNameInput initial={folder.name} onCommit={commitRename} onCancel={() => setEditing(false)} />
        ) : (
          <span className="truncate text-body-extra-small font-semibold text-text-primary" title={folder.name}>
            {folder.name}
          </span>
        )}
        <span className="shrink-0 text-caption text-text-faded">
          {fc("DeckCountFormat", { 0: counts.deckCount })}
        </span>
      </div>

      <Metric value={counts.new} color="var(--flashcard-state-new)" />
      <Metric value={counts.learning} color="var(--flashcard-state-learning)" />
      <Metric value={counts.due} color="var(--accent)" />
      {/* Folders show no retention bar. */}
      <span />

      <div className="flex items-center justify-end opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <Menu>
          <MenuTrigger asChild>
            <button
              type="button"
              aria-label={fc("FolderActions")}
              title={fc("FolderActions")}
              onClick={(event) => event.stopPropagation()}
              className="grid size-6 place-items-center rounded text-text-faded hover:bg-surface-subtle hover:text-text-secondary"
            >
              <AppIcon name="common/dots-vertical" size={16} />
            </button>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem icon="flyout/rename" onSelect={() => setEditing(true)}>
              {fc("RenameFolder")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon="common/trash" danger onSelect={() => void remove()}>
              {fc("DeleteFolder")}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </div>
  )
}

/**
 * The inline name editor. It keeps the draft local so Escape genuinely reverts —
 * the desktop version edits the folder in place and leaves a half-typed name on
 * screen until the next reload.
 */
function FolderNameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const cancelled = useRef(false)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.select()
  }, [])

  return (
    <input
      ref={ref}
      value={value}
      autoFocus
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onBlur={() => !cancelled.current && onCommit(value)}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === "Enter") onCommit(value)
        if (event.key === "Escape") {
          cancelled.current = true
          onCancel()
        }
      }}
      className="min-w-0 flex-1 bg-transparent text-body-extra-small font-semibold text-text-primary outline-none"
    />
  )
}

function Metric({ value, color }: { value: number; color: string }) {
  return (
    <span className={METRIC_CLASS} style={{ color: value === 0 ? "var(--text-disabled)" : color }}>
      {value}
    </span>
  )
}
