import type { ReactNode, Ref } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

/**
 * A review card's top-right actions. Hidden until the pointer is over the card, except that a set
 * flag pins them open so the card's state is visible. `leading` adds controls ahead of the three.
 */
export function CardCorner({
  isFlagged,
  canUndo,
  onEdit,
  onFlag,
  onUndo,
  leading,
  containerRef,
}: {
  isFlagged: boolean
  canUndo: boolean
  onEdit: () => void
  onFlag: () => void
  onUndo: () => void
  leading?: ReactNode
  containerRef?: Ref<HTMLDivElement>
}) {
  const t = useT()
  const fc = (key: string) => t("Flashcards", key)

  return (
    <div
      ref={containerRef}
      data-card-actions=""
      className={cn(
        "absolute top-3 right-3 flex items-center gap-0.5 transition-opacity",
        isFlagged ? "opacity-100" : "opacity-0 group-hover/card:opacity-100 focus-within:opacity-100",
      )}
    >
      {leading}
      <CardAction icon="flyout/rename" label={fc("StudyEdit")} onClick={onEdit} />
      <button
        type="button"
        aria-label={fc("StudyFlag")}
        aria-pressed={isFlagged}
        title={fc("StudyFlag")}
        onClick={onFlag}
        className={cn(
          "grid size-7 cursor-pointer place-items-center rounded-md transition-colors",
          isFlagged
            ? "text-state-due hover:bg-frame-hover [&>svg]:fill-current"
            : "text-ink-3 hover:bg-frame-hover hover:text-ink",
        )}
      >
        <AppIcon name="common/flag" size={15} />
      </button>
      <CardAction icon="common/undo" label={fc("StudyUndo")} onClick={onUndo} disabled={!canUndo} />
    </div>
  )
}

export function CardAction({
  icon,
  label,
  onClick,
  disabled,
  pressed,
  active,
}: {
  icon: string
  label: string
  onClick: () => void
  disabled?: boolean
  /** Set for a toggle; leaves the button a plain action when undefined. */
  pressed?: boolean
  /** Draws the button in its on state without making it a toggle. */
  active?: boolean
}): ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid size-7 cursor-pointer place-items-center rounded-md text-ink-3 transition-colors",
        "hover:bg-frame-hover hover:text-ink disabled:pointer-events-none disabled:opacity-30",
        (pressed || active) && "bg-frame-active text-ink",
      )}
    >
      <AppIcon name={icon} size={15} />
    </button>
  )
}
