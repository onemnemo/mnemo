import { useState } from "react"

import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import type { Point } from "../../model/scene"
import type { GroupBinding } from "./binding"
import type { ToolbarGroup } from "./groups"
import { OptionGlyph } from "./OptionGlyph"

export interface ToolbarShelfProps {
  readonly group: ToolbarGroup
  readonly binding: GroupBinding
  readonly open: boolean
  /** Top-left in pane pixels. */
  readonly at: Point
  /** Which way it slides away: toward the bar. */
  readonly travel: Point
}

/**
 * A group's options on a strip beside the bar, with a caption naming the one pointed at or picked.
 * The caption does the tooltips' job. Mounted while closed so it can slide away, and inert then.
 */
export function ToolbarShelf({ group, binding, open, at, travel }: ToolbarShelfProps) {
  const t = useT()
  const [pointed, setPointed] = useState<string | null>(null)
  const named = group.options.find((option) => option.id === (pointed ?? binding.captionId))

  return (
    <div
      role="group"
      aria-label={t("Mindmap", group.label)}
      aria-hidden={!open}
      inert={!open}
      data-mm-shelf={group.id}
      className={cn(
        "absolute flex h-11 items-center gap-0.5 rounded-[14px] bg-surface-float p-1 shadow-float",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
      style={{
        left: at.x,
        top: at.y,
        opacity: open ? 1 : 0,
        transform: open
          ? "none"
          : `translate(calc(var(--travel-pop) * ${travel.x}), calc(var(--travel-pop) * ${travel.y})) scale(0.98)`,
        transition:
          "opacity var(--duration-slow) var(--ease-out), transform var(--duration-shelf) var(--ease-settle)",
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {group.options.map((option) => {
        const picked = binding.isPicked(option.id)
        return (
          <button
            key={option.id}
            type="button"
            tabIndex={open ? 0 : -1}
            aria-label={t("Mindmap", option.label)}
            aria-pressed={picked}
            aria-keyshortcuts={option.key}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => binding.pick(option.id)}
            onPointerEnter={() => setPointed(option.id)}
            onPointerLeave={() => setPointed(null)}
            onFocus={() => setPointed(option.id)}
            onBlur={() => setPointed(null)}
            className={cn(
              "grid h-9 w-8 shrink-0 place-items-center rounded-[10px] outline-none transition-colors",
              "focus-visible:ring-2 focus-visible:ring-accent",
              picked ? "bg-frame-active text-ink" : "text-ink-2 hover:bg-frame-hover hover:text-ink",
            )}
          >
            <OptionGlyph group={group.id} id={option.id} picked={picked} />
          </button>
        )
      })}

      <span aria-hidden className="mx-[3px] h-6 w-px shrink-0 bg-line" />

      <span aria-hidden className="flex w-[104px] shrink-0 items-center justify-between gap-1.5 pr-1">
        <span className="truncate text-[12.5px] text-ink">{t("Mindmap", named?.label ?? group.label)}</span>
        {named ? (
          <kbd className="grid h-5 min-w-5 shrink-0 place-items-center rounded-[5px] px-1 font-sans text-[11px] font-medium text-ink-2 shadow-[0_0_0_1px_var(--line)]">
            {named.key}
          </kbd>
        ) : null}
      </span>
    </div>
  )
}
