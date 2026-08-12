import { useEffect, useRef, useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useInlineEditor } from "@/components/ui/useInlineEditor"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"
import { dialog } from "@/stores/dialog"

import { useDeleteFolder, useSaveFolder } from "../../api"
import type { DragHandle } from "../dnd/model"
import type { LibraryDrag } from "../dnd/useLibraryDrag"
import type { FolderRowModel } from "../tree"
import { Counts } from "../../bits"
import { folderMenuItems } from "./folder-row-menu-items"
import { FolderRowContextMenu } from "./FolderRowContextMenu"
import { FolderRowMenu } from "./FolderRowMenu"
import { DEPTH_INDENT, RETENTION_CELL } from "./rowLayout"

/** A folder in the library table: its own row, plus its subtree's totals. */
export function FolderRow({
  row,
  onToggle,
  drag,
}: {
  row: FolderRowModel
  onToggle: (id: string) => void
  drag: LibraryDrag
}) {
  const t = useT()
  const saveFolder = useSaveFolder()
  const deleteFolder = useDeleteFolder()
  const rename = useInlineEditor()
  const { folder, counts } = row
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

  const handle: DragHandle = {
    key: `folder:${folder.id}`,
    kind: "folder",
    id: folder.id,
    parentId: folder.parentId,
    label: folder.name,
    subtitle: fc("DeckCountFormat", { 0: counts.deckCount }),
  }

  const commitRename = async (name: string) => {
    rename.close()
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

  const entries = folderMenuItems({
    row,
    t,
    on: {
      toggle: () => onToggle(folder.id),
      rename: rename.openFromMenu,
      remove: () => void remove(),
    },
  })

  return (
    <FolderRowContextMenu entries={entries} disabled={rename.editing} opensEditor={rename.opensEditor}>
      <div
        role="row"
        tabIndex={0}
        data-row-key={handle.key}
        data-row-kind="folder"
        data-row-id={folder.id}
        data-row-depth={row.depth}
        data-row-folder={folder.id}
        onPointerDown={(event) => !rename.editing && drag.press(event, handle)}
        onClick={() => !drag.suppressClick(handle.key) && !rename.editing && onToggle(folder.id)}
        onDoubleClick={rename.open}
        onKeyDown={(event) => {
          if (rename.editing) return
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            onToggle(folder.id)
          }
        }}
        style={{
          opacity: drag.sourceKey === handle.key ? 0.35 : undefined,
          paddingLeft: 6 + row.depth * DEPTH_INDENT,
        }}
        className={cn(
          "group flex h-9 cursor-pointer items-center gap-2 rounded-lg pr-2 outline-none transition-colors",
          "hover:bg-frame-hover focus-visible:bg-frame-hover",
        )}
      >
        <AppIcon
          name="chevron-right"
          size={14}
          strokeWidth={2}
          className={cn("shrink-0 text-ink-icon transition-transform", row.expanded && "rotate-90")}
        />
        <AppIcon name="folder" size={16} className="shrink-0 text-ink-icon" />

        {rename.editing ? (
          <FolderNameInput initial={folder.name} onCommit={commitRename} onCancel={rename.close} />
        ) : (
          <span className="flex-1 truncate text-left text-[13px] font-medium text-ink" title={folder.name}>
            {folder.name}
          </span>
        )}
        <span className="shrink-0 text-[12px] text-ink-3">
          {counts.deckCount === 1 ? fc("DeckCountSingular") : fc("DeckCountFormat", { 0: counts.deckCount })}
        </span>

        {/* Only while collapsed: with the children on screen the aggregate is just
            the same numbers a second time. */}
        {row.expanded ? <span className="w-[100px] shrink-0" /> : <Counts counts={counts} className="shrink-0" />}
        <span className={RETENTION_CELL} />

        {/* The row toggles and drags, so the menu has to keep its own clicks to itself. */}
        <div className="flex shrink-0 items-center justify-end" onPointerDown={(event) => event.stopPropagation()}>
          <FolderRowMenu entries={entries} opensEditor={rename.opensEditor} />
        </div>
      </div>
    </FolderRowContextMenu>
  )
}

/**
 * The inline name editor. It keeps the draft local so Escape genuinely reverts,
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
      className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-ink outline-none"
    />
  )
}
