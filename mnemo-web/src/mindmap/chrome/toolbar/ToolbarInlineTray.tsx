import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import type { TooltipSide } from "@/components/ui/tooltip/placement"
import { Tooltip } from "@/components/ui/tooltip"
import type { GroupBinding } from "./binding"
import type { ToolbarGroup } from "./groups"
import { OptionGlyph } from "./OptionGlyph"
import { inlineLength, inlineSlot } from "./placement"
import { useOptionChord } from "./useOptionChord"

export interface ToolbarInlineTrayProps {
  readonly group: ToolbarGroup
  readonly binding: GroupBinding
  readonly open: boolean
  readonly vertical: boolean
  readonly tip: TooltipSide | null
}

/**
 * A small group's options on a sunken strip inside the bar, after the tool that owns it. Always
 * mounted, at no length while closed, so opening it pushes the tools after it along.
 */
export function ToolbarInlineTray({ group, binding, open, vertical, tip }: ToolbarInlineTrayProps) {
  const t = useT()
  const chordOf = useOptionChord()
  const count = group.options.length
  const length = open ? inlineSlot(count) : 0
  const strip = inlineLength(count)

  return (
    <div
      role="group"
      aria-label={t("Mindmap", group.label)}
      aria-hidden={!open}
      inert={!open}
      className="shrink-0 overflow-hidden"
      style={{
        [vertical ? "height" : "width"]: length,
        [vertical ? "width" : "height"]: 36,
        opacity: open ? 1 : 0,
        transition: `${vertical ? "height" : "width"} var(--duration-tray) var(--ease-settle), opacity var(--duration-conceal) var(--ease-out)`,
      }}
    >
      <div
        className={cn(
          "flex gap-0.5 rounded-[11px] bg-canvas-sunken p-[3px] shadow-[inset_0_0_0_1px_var(--line-soft)]",
          vertical ? "my-[3px] flex-col" : "mx-[3px]",
        )}
        style={{ [vertical ? "height" : "width"]: strip, [vertical ? "width" : "height"]: 36 }}
      >
        {group.options.map((option) => {
          const picked = binding.isPicked(option.id)
          const label = t("Mindmap", option.label)
          const chord = chordOf(option)
          return (
            <Tooltip key={option.id} label={tip ? label : ""} chord={chord} side={tip ?? undefined}>
              <button
                type="button"
                tabIndex={open ? 0 : -1}
                aria-label={label}
                aria-pressed={picked}
                aria-keyshortcuts={chord}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => binding.pick(option.id)}
                className={cn(
                  "grid shrink-0 place-items-center rounded-lg outline-none transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-accent",
                  vertical ? "h-8 w-[30px]" : "h-[30px] w-8",
                  picked ? "bg-surface-float text-ink shadow-raised" : "text-ink-2 hover:bg-frame-hover hover:text-ink",
                )}
              >
                <OptionGlyph group={group.id} id={option.id} picked={picked} />
              </button>
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}
