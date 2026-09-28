/**
 * What is inside the line bar's flyouts: a heading, a row of samples, and each end's caps.
 *
 * The node and edge bars stack full-width panels instead; their pieces live in ./panel.
 */

import type { ReactNode } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
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
