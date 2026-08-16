import { useState } from "react"
import { Popover } from "radix-ui"

import type { DeckSummaryDto } from "@/api/types"
import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu"
import { useT } from "@/i18n/useT"

/**
 * The batch-action bar, shown while any card on the page is selected.
 *
 * Checkboxes with nothing to do were the old table's real bug. The bar appears with
 * the first selection and says what it will act on, so the boxes always lead
 * somewhere.
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
    <div className="animate-rise pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-1.5 rounded-xl bg-canvas p-1.5 pl-3.5 shadow-pop">
        <span className="text-[12.5px] font-medium text-ink">{fc("DeckSelectedFormat", { 0: count })}</span>

        <Divider />

        <Menu>
          <MenuTrigger asChild>
            <Button variant="ghost" className="h-7" trailing={<AppIcon name="chevron-down" size={12} />}>
              {fc("BatchMove")}
            </Button>
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
            <Button variant="ghost" className="h-7" icon={<AppIcon name="tag" size={14} strokeWidth={1.7} />}>
              {fc("BatchTag")}
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="top"
              sideOffset={6}
              className="animate-pop-in z-50 flex items-center gap-1.5 rounded-lg bg-canvas p-1.5 shadow-pop"
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
                className="h-7 w-[150px] rounded-md bg-canvas-sunken px-2 text-[13px] text-ink placeholder:text-ink-3 focus:outline-none focus:shadow-[0_0_0_1px_var(--line)]"
              />
              <Popover.Close asChild>
                <Button size="sm" onClick={commitTag}>
                  {fc("CardEditorAddTag")}
                </Button>
              </Popover.Close>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        <Button
          variant="ghost"
          className="h-7"
          icon={<AppIcon name="common/pause" size={14} />}
          onClick={() => onSuspend(!allSuspended)}
        >
          {fc(allSuspended ? "BatchUnsuspend" : "BatchSuspend")}
        </Button>
        <Button
          variant="ghost"
          className="h-7"
          icon={<AppIcon name="common/flag" size={14} />}
          onClick={() => onFlag(!allFlagged)}
        >
          {fc(allFlagged ? "BatchUnflag" : "BatchFlag")}
        </Button>

        <Divider />

        <Button
          variant="danger"
          className="h-7"
          icon={<AppIcon name="common/trash" size={14} />}
          onClick={onDelete}
        >
          {t("Common", "Delete")}
        </Button>
        <Button variant="ghost" className="h-7" onClick={onClear}>
          {t("Common", "Cancel")}
        </Button>
      </div>
    </div>
  )
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-line-soft" />
}
