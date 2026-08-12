/**
 * What is inside a floating bar's menus.
 *
 * A bar has room for a handful of controls and the styles behind it have far more values than that,
 * so each family gets one slot that says what the selection is now and opens the rest. This is what
 * the inside of one of those looks like: a heading, a row of samples, a switch for how far a choice
 * reaches, and plain items for the things that are not styles at all.
 *
 * Shared rather than written per bar. A menu that opens off the node bar and one that opens off the
 * edge bar are the same object, and two implementations of it would drift within a week.
 */

import type { ReactNode } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import type { IconName } from "@/components/icon/icon-registry"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import type { ArrowCap } from "../model/document"
import { Slot } from "./bits"
import { CAPS } from "./choices"
import { FlyoutPanel } from "./FlyoutPanel"
import { EndsGlyph } from "./glyphs"

/**
 * A slot whose choices are too many to lay out on the bar.
 *
 * The face is the value the selection holds now, so an unopened control still says what the thing
 * is, and the caret says there is more behind it. The wrapper is `relative` because the panel
 * positions against the nearest positioned ancestor, and the control that owns a flyout is the one
 * that has to be it.
 */
export function Popped({
  label,
  face,
  open,
  onOpen,
  width,
  children,
}: {
  label: string
  face: ReactNode
  open: boolean
  onOpen: (open: boolean) => void
  /** A fixed width for the panel, for one whose rows should not set it themselves. */
  width?: string
  children: ReactNode
}) {
  return (
    <span className="relative flex">
      <Slot wide label={label} active={open} onClick={() => onOpen(!open)}>
        <span className="flex items-center gap-0.5">
          {face}
          <AppIcon name="chevron-down" size={11} className="opacity-55" />
        </span>
      </Slot>
      {open ? (
        <FlyoutPanel onClose={() => onOpen(false)} className={width}>
          {children}
        </FlyoutPanel>
      ) : null}
    </span>
  )
}

/** One family of values inside a panel, under its name. */
export function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="px-1 pb-1.5 last:pb-0.5">
      <h3 className="px-0.5 py-1 text-[9.5px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
        {label}
      </h3>
      <div className="flex gap-1">{children}</div>
    </section>
  )
}

/**
 * One value inside a panel.
 *
 * It grows to fill its row rather than being the bar's fixed square, so a row of three and a row of
 * four still line up down both edges of the panel.
 */
export function Cell({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "grid h-7 flex-1 place-items-center rounded-lg transition-colors duration-120",
        active ? "bg-frame-active text-ink" : "text-ink-2 hover:bg-frame-hover hover:text-ink",
      )}
    >
      {children}
    </button>
  )
}

/**
 * One end of an edge, and the three things it can be.
 *
 * The end's name is on the row rather than only in a tooltip, because two rows of the same three
 * glyphs are otherwise told apart only by which way they point, and at twenty pixels that is a
 * detail to squint at rather than a label to read. Each choice is drawn as the whole edge with the
 * cap on the end being set, so a picked value and the slot's face show the same picture.
 */
export function CapRow({
  label,
  end,
  value,
  onPick,
}: {
  label: string
  end: "start" | "end"
  value: ArrowCap
  onPick: (cap: ArrowCap) => void
}) {
  const t = useT()
  return (
    <div className="flex flex-1 items-center gap-1">
      <span className="w-[34px] shrink-0 text-[10.5px] text-ink-3">{label}</span>
      {CAPS.map((cap) => (
        <Cell
          key={cap.value}
          label={`${label} ${t("Mindmap", cap.key)}`}
          active={value === cap.value}
          onClick={() => onPick(cap.value)}
        >
          <EndsGlyph
            start={end === "start" ? cap.value : "none"}
            end={end === "end" ? cap.value : "none"}
          />
        </Cell>
      ))}
    </div>
  )
}

/** Something a selection can be told to do, as opposed to something it can be styled to look like. */
export function MenuItem({
  label,
  icon,
  danger,
  disabled,
  onClick,
}: {
  label: string
  icon: IconName
  /** Red, for the one item that cannot be walked back by pressing something else. */
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition-colors duration-120",
        disabled && "pointer-events-none opacity-35",
        danger
          ? "text-danger hover:bg-danger-wash"
          : "text-ink-2 hover:bg-frame-hover hover:text-ink",
      )}
    >
      <AppIcon name={icon} size={14} />
      <span className="flex-1 truncate">{label}</span>
    </button>
  )
}

/**
 * How far the choices above it reach.
 *
 * The whole row is the control, which is why the track and knob are drawn here rather than by the
 * app's switch: that is a button of its own, and a row that is itself a button cannot hold one.
 */
export function MenuToggle({
  label,
  on,
  disabled,
  onToggle,
}: {
  label: string
  on: boolean
  disabled?: boolean
  onToggle: (on: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onToggle(!on)}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11.5px] transition-colors duration-120",
        disabled ? "pointer-events-none opacity-35" : "hover:bg-frame-hover",
        on ? "text-ink" : "text-ink-2",
      )}
    >
      <span className="flex-1">{label}</span>
      <span
        className={cn(
          "relative inline-flex h-[16px] w-[27px] shrink-0 items-center rounded-full transition-colors",
          on ? "bg-solid" : "bg-frame-active",
        )}
        aria-hidden
      >
        <span
          className={cn(
            "inline-block size-[11px] rounded-full bg-canvas shadow-sm transition-transform",
            on ? "translate-x-[13px]" : "translate-x-[2px]",
          )}
        />
      </span>
    </button>
  )
}

/** A hairline across a menu, between items that undo differently. */
export function MenuSep() {
  return <span className="my-1 block h-px bg-line" aria-hidden />
}
