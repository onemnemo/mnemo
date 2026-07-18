import { useState } from "react"
import { Popover } from "radix-ui"

import type { DeckSummaryDto } from "@/api/types"
import { AppIcon } from "@/components/icon/AppIcon"
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

const ACTION_CLASS =
  "rounded-md px-2 py-[5px] text-body-extra-small text-[var(--floating-chrome-row-text)] hover:bg-[var(--floating-chrome-hover)]"

/**
 * The floating batch-action bar, shown while any card on the page is selected.
 * Dark floating chrome rather than page surface, so it reads as an overlay over
 * the table rather than another row of it.
 */
export function SelectionBar({
  count,
  allSuspended,
  allFlagged,
  moveTargets,
  onMove,
  onTag,
  onSuspend,
  onFlag,
  onDelete,
  onClear,
}: {
  count: number
  allSuspended: boolean
  allFlagged: boolean
  moveTargets: DeckSummaryDto[]
  onMove: (targetDeckId: string) => void
  onTag: (tag: string) => void
  onSuspend: (value: boolean) => void
  onFlag: (value: boolean) => void
  onDelete: () => void
  onClear: () => void
}) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)
  const [tag, setTag] = useState("")

  const commitTag = () => {
    const value = tag.trim()
    if (!value) return
    onTag(value)
    setTag("")
  }

  return (
    <div className="pointer-events-none sticky bottom-6 z-20 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-2.5 rounded-lg bg-[var(--floating-chrome-background)] px-3.5 py-2 shadow-[0_16px_44px_0_rgba(0,0,0,0.4)]">
        <span className="text-body-extra-small font-semibold text-[var(--floating-chrome-foreground-strong)]">
          {fc("DeckSelectedFormat", { 0: count })}
        </span>

        <Divider />

        <Menu>
          <MenuTrigger asChild>
            <button type="button" className={cn(ACTION_CLASS, "flex items-center gap-1")}>
              {fc("BatchMove")}
              <AppIcon name="common/chevron-down" size={10} />
            </button>
          </MenuTrigger>
          <MenuContent align="start">
            {moveTargets.map((deck) => (
              <MenuItem key={deck.id} onSelect={() => onMove(deck.id)}>
                {deck.name}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>

        <Popover.Root>
          <Popover.Trigger asChild>
            <button type="button" className={ACTION_CLASS}>
              {fc("BatchTag")}
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="top"
              sideOffset={6}
              className="z-50 flex items-center gap-1.5 rounded-lg border border-line bg-popover p-1.5 shadow-elevation-2"
            >
              <input
                value={tag}
                autoFocus
                onChange={(event) => setTag(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitTag()
                }}
                placeholder={fc("TagAddPlaceholder")}
                aria-label={fc("TagAddPlaceholder")}
                className="h-7 w-[150px] rounded-md border border-line bg-surface px-2 text-body-extra-small text-text-primary outline-none placeholder:text-text-faded focus:border-brand"
              />
              <Popover.Close asChild>
                <button
                  type="button"
                  onClick={commitTag}
                  className="h-7 rounded-md bg-brand px-2.5 text-body-extra-small font-medium text-white"
                >
                  {fc("CardEditorAddTag")}
                </button>
              </Popover.Close>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        <button type="button" className={ACTION_CLASS} onClick={() => onSuspend(!allSuspended)}>
          {fc(allSuspended ? "BatchUnsuspend" : "BatchSuspend")}
        </button>
        <button type="button" className={ACTION_CLASS} onClick={() => onFlag(!allFlagged)}>
          {fc(allFlagged ? "BatchUnflag" : "BatchFlag")}
        </button>

        <Divider />

        <button
          type="button"
          onClick={onDelete}
          className="rounded-md px-2 py-[5px] text-body-extra-small text-[var(--floating-chrome-danger)] hover:bg-[var(--floating-chrome-danger-hover)]"
        >
          {t("Common", "Delete")}
        </button>
        <button
          type="button"
          onClick={onClear}
          aria-label={fc("ClearSelection")}
          title={fc("ClearSelection")}
          className="grid size-6 place-items-center rounded-md text-[var(--floating-chrome-row-text)] hover:bg-[var(--floating-chrome-hover)]"
        >
          <AppIcon name="common/x" size={12} />
        </button>
      </div>
    </div>
  )
}

function Divider() {
  return <span className="h-[18px] w-px bg-[var(--floating-chrome-divider)]" />
}
