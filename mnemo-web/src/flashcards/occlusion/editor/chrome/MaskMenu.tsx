import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu"

import type { EditorAction } from "../keys"
import type { MaskMenuItem } from "./mask-menu"

/** Draws the items inside a context menu. `onPick` runs the chosen action. */
export function MaskMenuContent({
  items,
  onPick,
  keepFocusAfter,
}: {
  items: readonly MaskMenuItem[]
  onPick: (action: EditorAction) => void
  /** The action whose result puts a caret on screen, so focus is not handed back to the trigger. */
  keepFocusAfter: { current: EditorAction | null }
}) {
  return (
    <ContextMenuContent
      opensDialog={() => {
        const renamed = keepFocusAfter.current === "rename"
        keepFocusAfter.current = null
        return renamed
      }}
    >
      {items.map((item) => (
        <MenuEntry key={item.action} item={item} onPick={onPick} keepFocusAfter={keepFocusAfter} />
      ))}
    </ContextMenuContent>
  )
}

function MenuEntry({
  item,
  onPick,
  keepFocusAfter,
}: {
  item: MaskMenuItem
  onPick: (action: EditorAction) => void
  keepFocusAfter: { current: EditorAction | null }
}) {
  return (
    <>
      {item.separatorBefore ? <ContextMenuSeparator /> : null}
      <ContextMenuItem
        icon={item.icon}
        hint={item.hint}
        danger={item.danger}
        disabled={item.disabled}
        onSelect={() => {
          keepFocusAfter.current = item.action
          onPick(item.action)
        }}
      >
        {item.label}
      </ContextMenuItem>
    </>
  )
}
