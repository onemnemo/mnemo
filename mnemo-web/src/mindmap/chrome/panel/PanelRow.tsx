import type { ReactNode } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import type { IconName } from "@/components/icon/icon-registry"
import { useShortcutLabel } from "@/keybinds/store"
import { cn } from "@/lib/utils"

/**
 * One row of a list panel: icon, label, and whatever sits on the right. `shortcut` names a keybind
 * action rather than a key, so the row shows the user's binding, or nothing once unbound.
 */
export function PanelRow({
  icon,
  label,
  shortcut,
  trailing,
  danger,
  pressed,
  onClick,
}: {
  icon: IconName
  label: string
  shortcut?: string
  trailing?: ReactNode
  danger?: boolean
  /** For a row that picks a value: the current one wears the hover wash and says so. */
  pressed?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "flex h-[34px] w-full items-center gap-2.5 rounded-[9px] px-2 text-left text-[13px] outline-none",
        "transition-colors duration-(--duration-press) ease-[ease] focus-visible:ring-2 focus-visible:ring-accent",
        danger ? "text-danger hover:bg-danger-wash" : "text-ink hover:bg-frame-hover",
        pressed && "bg-frame-hover",
      )}
    >
      <AppIcon name={icon} size={16} strokeWidth={1.8} className={danger ? undefined : "text-ink-2"} />
      <span className="grow truncate">{label}</span>
      {shortcut ? <Shortcut action={shortcut} /> : null}
      {trailing}
    </button>
  )
}

function Shortcut({ action }: { action: string }) {
  const keys = useShortcutLabel(action)
  return keys ? <span className="shrink-0 text-[11.5px] text-ink-3">{keys}</span> : null
}
