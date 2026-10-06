import { memo, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

export interface CardRowProps {
  /** The first mask of the card, which is what every handler is told about. */
  id: string
  cardKey: string
  number: number
  label: string
  grouped: boolean
  /** The label of the card's first member, which is what a rename edits. */
  ownLabel: string
  selected: boolean
  /** The one row the Tab key reaches. */
  tabStop: boolean
  renaming: boolean
  /** Fades the row while it is the one being dragged. */
  dragging: boolean
  /** A line drawn above (or, for the last row, below) when a drag would land here. */
  dropMark: "before" | "after" | null
  onSelect: (id: string, event: MouseEvent) => void
  onHover: (id: string | null) => void
  onStartRename: (id: string) => void
  /** `viaKey` is false when the field lost focus or went away, so focus is not pulled back. */
  onCommit: (id: string, label: string, viaKey: boolean) => void
  onCancel: () => void
  /** Commits and moves to the next (or, with Shift, previous) card's label. */
  onTab: (id: string, label: string, backwards: boolean) => void
  onGripPress: (id: string, event: PointerEvent) => void
  onKey: (id: string, event: KeyboardEvent) => void
}

/**
 * One card of the list: its number, its label (or the field to rename it) and the grip to reorder.
 * A grid row rather than a listbox option, because the rename field is interactive content.
 */
export const CardRow = memo(function CardRow(props: CardRowProps) {
  const { id, selected, renaming, onHover } = props
  const t = useT()
  const hovered = useRef(false)

  // A row that goes away under the pointer never sees the pointer leave.
  useEffect(
    () => () => {
      if (hovered.current) onHover(null)
    },
    [onHover],
  )

  return (
    <div
      role="row"
      aria-selected={selected}
      tabIndex={props.tabStop ? 0 : -1}
      data-card-row={props.cardKey}
      data-grouped={props.grouped ? "" : undefined}
      onClick={(event) => props.onSelect(id, event)}
      onDoubleClick={() => props.onStartRename(id)}
      onMouseEnter={() => {
        hovered.current = true
        onHover(id)
      }}
      onMouseLeave={() => {
        hovered.current = false
        onHover(null)
      }}
      onKeyDown={(event) => props.onKey(id, event)}
      className={cn(
        "group relative flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-accent",
        selected ? "bg-frame-active" : "hover:bg-frame-hover",
        props.dragging && "opacity-50",
      )}
    >
      {props.dropMark ? (
        <span
          aria-hidden
          data-drop-mark={props.dropMark}
          className={cn("absolute inset-x-1 h-0.5 rounded-full bg-accent", props.dropMark === "before" ? "-top-px" : "-bottom-px")}
        />
      ) : null}
      <div role="gridcell" className="contents">
        <span
          className={cn(
            "grid h-[18px] min-w-[22px] shrink-0 place-items-center rounded-[5px] px-1 text-[11px] font-semibold tabular-nums",
            selected ? "bg-solid text-solid-fg" : "bg-canvas-sunken text-ink-2",
          )}
        >
          {props.number}
        </span>
        {renaming ? (
          <RenameInput
            initial={props.ownLabel}
            label={t("Flashcards", "OcclusionLabelInput", { number: props.number })}
            onCommit={(label, viaKey) => props.onCommit(id, label, viaKey)}
            onCancel={props.onCancel}
            onTab={(label, backwards) => props.onTab(id, label, backwards)}
          />
        ) : (
          <span className={cn("min-w-0 flex-1 truncate", props.label ? "text-ink" : "text-ink-3")}>
            {props.label || t("Flashcards", "OcclusionNoLabel")}
          </span>
        )}
        {props.grouped ? (
          <AppIcon name="link" size={13} strokeWidth={2} className="shrink-0 text-ink-3" title={t("Flashcards", "OcclusionGrouped")} />
        ) : null}
        <span
          aria-hidden
          data-grip=""
          onPointerDown={(event) => props.onGripPress(id, event)}
          className="grid size-5 shrink-0 cursor-grab touch-none place-items-center text-ink-icon opacity-0 group-hover:opacity-100"
        >
          <AppIcon name="common/grip-vertical" size={14} />
        </span>
      </div>
    </div>
  )
})

function RenameInput({
  initial,
  label,
  onCommit,
  onCancel,
  onTab,
}: {
  initial: string
  label: string
  onCommit: (label: string, viaKey: boolean) => void
  onCancel: () => void
  onTab: (label: string, backwards: boolean) => void
}) {
  const [value, setValue] = useState(initial)
  const input = useRef<HTMLInputElement>(null)
  const latest = useRef({ value, onCommit })
  latest.current = { value, onCommit }
  // Enter, Tab and Escape each end the edit and then remove the field, which blurs it; only the first counts.
  const done = useRef(false)
  const finish = (run: () => void) => {
    if (done.current) return
    done.current = true
    run()
  }

  useEffect(() => {
    const field = input.current
    field?.focus()
    field?.select()
    // A field removed from under the user, such as a list that closed around it, still keeps what
    // was typed. A strict-mode rerun leaves the field attached, so it is not mistaken for that.
    return () => {
      if (field && !field.isConnected && !done.current) {
        done.current = true
        latest.current.onCommit(latest.current.value, false)
      }
    }
  }, [])

  return (
    <input
      ref={input}
      data-inline-editor=""
      aria-label={label}
      value={value}
      maxLength={200}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onBlur={() => finish(() => onCommit(value, false))}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault()
          finish(() => onCommit(value, true))
        } else if (event.key === "Escape") {
          event.preventDefault()
          event.stopPropagation()
          finish(onCancel)
        } else if (event.key === "Tab") {
          event.preventDefault()
          finish(() => onTab(value, event.shiftKey))
        }
      }}
      className="h-6 min-w-0 flex-1 rounded-[5px] bg-canvas px-1.5 text-[13px] text-ink shadow-[inset_0_0_0_1.5px_var(--solid)] outline-none selection:bg-accent/20"
    />
  )
}
